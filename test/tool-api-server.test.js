const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { ToolApiServer } = require('../lib/tool-api-server')

function request(port, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const raw = body == null ? null : Buffer.from(JSON.stringify(body))
    const req = http.request({
      host: '127.0.0.1', port, method, path,
      headers: raw ? { 'content-type': 'application/json', 'content-length': raw.length } : {}
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({
        status: res.statusCode,
        json: JSON.parse(Buffer.concat(chunks).toString('utf8'))
      }))
    })
    req.on('error', reject)
    if (raw) req.write(raw)
    req.end()
  })
}

function fixture() {
  const calls = []
  const layer = {
    availableActions: () => ['get_state', 'gather', 'stop'],
    state: () => ({ worker: 'wood-1', health: 20, availableActions: ['get_state', 'gather', 'stop'] }),
    async execute(value) { calls.push(value); return { success: true, action: value.action } }
  }
  const worker = {
    name: 'wood-1', role: 'lenhador',
    bot: { entity: { position: {} }, minecraftTools: layer }
  }
  const botManager = {
    workers: new Map([[worker.name, worker]]),
    get: name => name === worker.name ? worker : null
  }
  return { calls, worker, botManager }
}

test('Tool API exposes worker state and capabilities on loopback', async t => {
  const { botManager } = fixture()
  const server = new ToolApiServer({ botManager, port: 0, logger: { log() {} } })
  server.start()
  t.after(() => server.stop())
  await new Promise(resolve => server.server.once('listening', resolve))
  const port = server.server.address().port

  const workers = await request(port, 'GET', '/v1/workers')
  assert.equal(workers.status, 200)
  assert.equal(workers.json[0].id, 'wood-1')
  assert.deepEqual(workers.json[0].tools, ['get_state', 'gather', 'stop'])

  const state = await request(port, 'GET', '/v1/workers/wood-1/state')
  assert.equal(state.status, 200)
  assert.equal(state.json.health, 20)
})

test('Tool API routes only structured tool request to selected worker', async t => {
  const { botManager, calls } = fixture()
  const server = new ToolApiServer({ botManager, port: 0, logger: { log() {} } })
  server.start()
  t.after(() => server.stop())
  await new Promise(resolve => server.server.once('listening', resolve))
  const port = server.server.address().port

  const response = await request(port, 'POST', '/v1/workers/wood-1/tools/gather', {
    task_id: 'real-1',
    objective: 'collect wood',
    args: { resource: 'oak_log', quantity: 6 }
  })
  assert.equal(response.status, 200)
  assert.deepEqual(calls[0], {
    worker: 'wood-1',
    task_id: 'real-1',
    objective: 'collect wood',
    action: 'gather',
    args: { resource: 'oak_log', quantity: 6 }
  })
})

test('Tool API does not expose unknown workers or arbitrary routes', async t => {
  const { botManager } = fixture()
  const server = new ToolApiServer({ botManager, port: 0, logger: { log() {} } })
  server.start()
  t.after(() => server.stop())
  await new Promise(resolve => server.server.once('listening', resolve))
  const port = server.server.address().port
  assert.equal((await request(port, 'GET', '/v1/workers/nope/state')).status, 404)
  assert.equal((await request(port, 'POST', '/shell', { command: 'rm -rf /' })).status, 404)
})
