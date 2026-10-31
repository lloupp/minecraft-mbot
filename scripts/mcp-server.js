#!/usr/bin/env node
'use strict'

// Servidor MCP opcional (stdio) sobre a Tool API local do bot.
//
// Não fala com o Minecraft: só repassa para http://127.0.0.1:3091 (MBOT_TOOL_API=1),
// que valida argumentos, identidade do worker, reserva e checkpoints. Sem
// dependências: JSON-RPC 2.0, uma mensagem por linha (transporte stdio do MCP).
//
// Uso: node scripts/mcp-server.js   (ver docs/MCP.md)

const readline = require('node:readline')
const { randomUUID } = require('node:crypto')

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const SERVER_INFO = { name: 'minecraft-mbot', version: '1.0.0' }

const worker = { type: 'string', description: 'Nome do worker (ex.: lenhador_01). Veja list_workers.' }
const taskId = { type: 'string', description: 'ID estável para retentar sem repetir a ação. Opcional.' }
const quantity = { type: 'integer', minimum: 1, maximum: 256 }

// Cada ferramenta MCP vira uma chamada da Tool API.
const TOOLS = [
  { name: 'list_workers', description: 'Lista os workers da colônia, papel, conexão e ações disponíveis.', readOnly: true,
    inputSchema: { type: 'object', properties: {} }, request: () => ['GET', '/v1/workers'] },
  { name: 'worker_state', description: 'Estado de um worker: vida, fome, posição, inventário e tarefa atual.', readOnly: true,
    inputSchema: { type: 'object', properties: { worker }, required: ['worker'] }, request: (a) => ['GET', `/v1/workers/${enc(a.worker)}/state`] },
  { name: 'worker_stop', description: 'Cancela a tarefa em andamento do worker.',
    inputSchema: { type: 'object', properties: { worker, task_id: taskId }, required: ['worker'] }, action: 'stop', args: () => ({}) },
  { name: 'worker_eat', description: 'Manda o worker comer o que tiver.',
    inputSchema: { type: 'object', properties: { worker, task_id: taskId }, required: ['worker'] }, action: 'eat', args: () => ({}) },
  { name: 'worker_move_to', description: 'Leva o worker até uma posição (x, y, z) na mesma dimensão.',
    inputSchema: { type: 'object', properties: { worker, x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' }, task_id: taskId }, required: ['worker', 'x', 'y', 'z'] },
    action: 'move_to', args: (a) => ({ position: { x: a.x, y: a.y, z: a.z } }) },
  { name: 'worker_gather', description: 'Coleta blocos (ex.: oak_log, madeira, pedra) e confere o que entrou no inventário.',
    inputSchema: { type: 'object', properties: { worker, resource: { type: 'string' }, quantity, task_id: taskId }, required: ['worker', 'resource', 'quantity'] },
    action: 'gather', args: (a) => ({ resource: a.resource, quantity: a.quantity }) },
  { name: 'worker_craft', description: 'Fabrica um item (usa a bancada quando precisa).',
    inputSchema: { type: 'object', properties: { worker, item: { type: 'string' }, quantity, task_id: taskId }, required: ['worker', 'item', 'quantity'] },
    action: 'craft', args: (a) => ({ item: a.item, quantity: a.quantity }) },
  { name: 'worker_deposit', description: 'Descarrega o inventário do worker no estoque central.',
    inputSchema: { type: 'object', properties: { worker, task_id: taskId }, required: ['worker'] }, action: 'deposit', args: () => ({}) },
  { name: 'worker_withdraw', description: 'Retira um item do estoque central.',
    inputSchema: { type: 'object', properties: { worker, item: { type: 'string' }, quantity, task_id: taskId }, required: ['worker', 'item', 'quantity'] },
    action: 'withdraw', args: (a) => ({ item: a.item, quantity: a.quantity }) }
]

function enc(value) {
  if (typeof value !== 'string' || !value) throw new Error('worker é obrigatório')
  return encodeURIComponent(value)
}

function listTools() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { readOnlyHint: Boolean(tool.readOnly), destructiveHint: false, openWorldHint: false }
  }))
}

function createHandler({ baseUrl = process.env.MBOT_TOOL_API_URL || 'http://127.0.0.1:3091', fetchImpl = global.fetch, timeoutMs = 120000 } = {}) {
  async function callApi(method, path, body) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(new URL(path, baseUrl), {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      })
      const text = await response.text()
      let data
      try { data = text ? JSON.parse(text) : null } catch { data = text }
      return { status: response.status, data }
    } finally {
      clearTimeout(timer)
    }
  }

  async function callTool(name, args = {}) {
    const tool = TOOLS.find((t) => t.name === name)
    if (!tool) return toolError(`ferramenta desconhecida: ${name}`)
    try {
      const [method, path, body] = tool.request
        ? tool.request(args)
        : ['POST', `/v1/workers/${enc(args.worker)}/tools/${tool.action}`, {
            task_id: args.task_id || `mcp-${randomUUID()}`,
            objective: `mcp:${name}`,
            args: tool.args(args)
          }]
      const { status, data } = await callApi(method, path, body)
      const failed = status >= 400 || (data && typeof data === 'object' && data.success === false)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError: Boolean(failed) }
    } catch (error) {
      const reason = error?.name === 'AbortError' ? 'tempo esgotado' : error?.message || String(error)
      return toolError(`Tool API indisponível em ${baseUrl} (${reason}). Inicie o bot com MBOT_TOOL_API=1.`)
    }
  }

  // Uma mensagem JSON-RPC -> resposta (ou null para notificações).
  async function handle(message) {
    const { id, method, params } = message || {}
    const reply = (result) => ({ jsonrpc: '2.0', id, result })
    const fail = (code, text) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message: text } })
    if (!message || message.jsonrpc !== '2.0' || typeof method !== 'string') return fail(-32600, 'Invalid Request')
    const isNotification = id === undefined
    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion
        return reply({
          protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: 'Controla os workers do minecraft-mbot pela Tool API local. Use list_workers primeiro.'
        })
      }
      case 'ping': return reply({})
      case 'tools/list': return reply({ tools: listTools() })
      case 'tools/call': return reply(await callTool(params?.name, params?.arguments || {}))
      default:
        if (isNotification) return null
        return fail(-32601, `Method not found: ${method}`)
    }
  }

  return { handle, callTool }
}

function toolError(text) {
  return { content: [{ type: 'text', text }], isError: true }
}

function serveStdio(handler = createHandler(), { input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input })
  const write = (msg) => { if (msg) output.write(JSON.stringify(msg) + '\n') }
  rl.on('line', async (line) => {
    if (!line.trim()) return
    let message
    try { message = JSON.parse(line) } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }
    try {
      write(await handler.handle(message))
    } catch (error) {
      write({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32603, message: error?.message || 'Internal error' } })
    }
  })
  return rl
}

if (require.main === module) serveStdio()

module.exports = { createHandler, serveStdio, listTools, TOOLS, SUPPORTED_VERSIONS }
