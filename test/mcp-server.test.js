const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const { spawn } = require('node:child_process')
const readline = require('node:readline')
const { createHandler, TOOLS } = require('../scripts/mcp-server')

// Tool API falsa: registra as requisições e responde como a real.
async function fakeToolApi() {
  const requests = []
  const server = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push({ method: req.method, url: req.url, contentType: req.headers['content-type'] || null, body: body ? JSON.parse(body) : null })
    res.setHeader('content-type', 'application/json')
    if (req.url === '/v1/workers') return res.end(JSON.stringify([{ id: 'lenhador_01', role: 'lenhador', connected: true, tools: ['gather'] }]))
    if (req.url === '/v1/workers/lenhador_01/state') return res.end(JSON.stringify({ worker: 'lenhador_01', health: 20 }))
    if (req.url === '/v1/workers/lenhador_01/tools/gather') return res.end(JSON.stringify({ success: true, result: { gathered: 3 } }))
    if (req.url === '/v1/workers/lenhador_01/tools/stop') { res.statusCode = 400; return res.end(JSON.stringify({ success: false, rejected: true, reason: 'worker_busy' })) }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'worker_not_found' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { requests, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('initialize negocia a versão e anuncia só ferramentas', async () => {
  const { handle } = createHandler({ baseUrl: 'http://127.0.0.1:1' })
  const res = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } })
  assert.equal(res.result.protocolVersion, '2025-03-26')
  assert.deepEqual(Object.keys(res.result.capabilities), ['tools'])
  const old = await handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })
  assert.equal(old.result.protocolVersion, '2025-06-18')
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null)
  assert.equal((await handle({ jsonrpc: '2.0', id: 3, method: 'nada' })).error.code, -32601)
})

test('tools/list expõe esquemas e marca leituras como somente leitura', async () => {
  const { handle } = createHandler({ baseUrl: 'http://127.0.0.1:1' })
  const { result } = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  assert.equal(result.tools.length, TOOLS.length)
  const gather = result.tools.find((t) => t.name === 'worker_gather')
  assert.deepEqual(gather.inputSchema.required, ['worker', 'resource', 'quantity'])
  assert.equal(result.tools.find((t) => t.name === 'list_workers').annotations.readOnlyHint, true)
  assert.equal(gather.annotations.readOnlyHint, false)
})

test('tools/call repassa para a Tool API com JSON, task_id e args no formato dela', async () => {
  const api = await fakeToolApi()
  try {
    const { handle } = createHandler({ baseUrl: api.url })
    const list = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_workers', arguments: {} } })
    assert.equal(list.result.isError, false)
    assert.equal(JSON.parse(list.result.content[0].text)[0].id, 'lenhador_01')

    const gather = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'worker_gather', arguments: { worker: 'lenhador_01', resource: 'oak_log', quantity: 3, task_id: 'mcp-1' } } })
    assert.equal(gather.result.isError, false)
    const post = api.requests.at(-1)
    assert.equal(post.method, 'POST')
    assert.equal(post.url, '/v1/workers/lenhador_01/tools/gather')
    assert.equal(post.contentType, 'application/json')
    assert.deepEqual(post.body, { task_id: 'mcp-1', objective: 'mcp:worker_gather', args: { resource: 'oak_log', quantity: 3 } })

    await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'worker_move_to', arguments: { worker: 'lenhador_01', x: 1, y: 64, z: -2 } } })
    assert.deepEqual(api.requests.at(-1).body.args, { position: { x: 1, y: 64, z: -2 } })
    assert.match(api.requests.at(-1).body.task_id, /^mcp-/)

    const busy = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'worker_stop', arguments: { worker: 'lenhador_01' } } })
    assert.equal(busy.result.isError, true)
    assert.match(busy.result.content[0].text, /worker_busy/)
  } finally {
    await api.close()
  }
})

test('Tool API fora do ar vira erro da ferramenta, não do protocolo', async () => {
  const { handle } = createHandler({ baseUrl: 'http://127.0.0.1:1' })
  const res = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_workers', arguments: {} } })
  assert.equal(res.result.isError, true)
  assert.match(res.result.content[0].text, /MBOT_TOOL_API=1/)
  const missing = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'worker_state', arguments: {} } })
  assert.match(missing.result.content[0].text, /worker é obrigatório/)
})

test('processo stdio: uma linha JSON-RPC por mensagem, erro de parse responde -32700', async () => {
  const api = await fakeToolApi()
  const child = spawn(process.execPath, [path.join(__dirname, '../scripts/mcp-server.js')], { env: { ...process.env, MBOT_TOOL_API_URL: api.url } })
  const lines = readline.createInterface({ input: child.stdout })
  const next = () => new Promise((resolve) => lines.once('line', (line) => resolve(JSON.parse(line))))
  try {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n')
    assert.equal((await next()).result.serverInfo.name, 'minecraft-mbot')
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'worker_state', arguments: { worker: 'lenhador_01' } } }) + '\n')
    const state = await next()
    assert.equal(state.id, 2)
    assert.equal(JSON.parse(state.result.content[0].text).health, 20)
    child.stdin.write('{nao e json\n')
    assert.equal((await next()).error.code, -32700)
  } finally {
    child.kill()
    await api.close()
  }
})
