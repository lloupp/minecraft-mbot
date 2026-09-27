'use strict'

const http = require('node:http')

const MAX_BODY_BYTES = 16 * 1024
const WORKER_PATH = /^\/v1\/workers\/([a-zA-Z0-9._:-]{1,120})(?:\/(state|tools)(?:\/([a-zA-Z0-9_:-]{1,80}))?)?$/

class ToolApiServer {
  constructor({ botManager, host = '127.0.0.1', port = Number(process.env.MBOT_TOOL_API_PORT || 3091), logger = console } = {}) {
    this.botManager = botManager
    this.host = host
    this.port = port
    this.logger = logger
    this.server = null
  }

  start() {
    if (this.server) return this.server
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch(error => this.json(res, 500, { error: 'internal_error', message: error.message }))
    })
    this.server.listen(this.port, this.host, () => {
      const address = this.server.address()
      this.logger.log?.(`[tool-api] http://${this.host}:${address.port}/v1/workers`)
    })
    return this.server
  }

  async stop() {
    if (!this.server) return
    const server = this.server
    this.server = null
    await new Promise(resolve => server.close(resolve))
  }

  workers() {
    return [...(this.botManager?.workers?.values?.() || [])]
  }

  layer(name) {
    const worker = this.botManager?.get?.(name) || this.workers().find(entry => entry.name === name)
    return worker?.bot?.minecraftTools || null
  }

  json(res, status, body) {
    const raw = Buffer.from(JSON.stringify(body))
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': raw.length,
      'cache-control': 'no-store'
    })
    res.end(raw)
  }

  async body(req) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        const error = new Error('request body too large')
        error.code = 'BODY_TOO_LARGE'
        throw error
      }
      chunks.push(chunk)
    }
    if (!chunks.length) return {}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }

  async handle(req, res) {
    if (req.method === 'GET' && req.url === '/health') {
      return this.json(res, 200, { status: 'ok', loopback: this.host === '127.0.0.1' })
    }
    if (req.method === 'GET' && req.url === '/v1/workers') {
      return this.json(res, 200, this.workers().map(worker => ({
        id: worker.name,
        role: worker.role,
        connected: Boolean(worker.bot?.entity),
        tools: worker.bot?.minecraftTools?.availableActions?.() || []
      })))
    }

    const match = WORKER_PATH.exec(req.url || '')
    if (!match) return this.json(res, 404, { error: 'not_found' })
    const [, workerId, resource, action] = match
    const layer = this.layer(workerId)
    if (!layer) return this.json(res, 404, { error: 'worker_not_found' })

    if (req.method === 'GET' && resource === 'state') {
      return this.json(res, 200, layer.state())
    }
    if (req.method === 'GET' && resource === 'tools' && !action) {
      return this.json(res, 200, layer.availableActions())
    }
    if (req.method === 'POST' && resource === 'tools' && action) {
      let body
      try {
        body = await this.body(req)
      } catch (error) {
        return this.json(res, error.code === 'BODY_TOO_LARGE' ? 413 : 400, { error: 'invalid_body' })
      }
      const result = await layer.execute({
        worker: workerId,
        task_id: body.task_id || null,
        objective: body.objective || null,
        action,
        args: body.args || {}
      })
      return this.json(res, result.rejected ? 400 : 200, result)
    }
    return this.json(res, 405, { error: 'method_not_allowed' })
  }
}

module.exports = { ToolApiServer, MAX_BODY_BYTES, WORKER_PATH }
