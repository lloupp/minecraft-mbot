const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { startToolApiRuntime } = require('../lib/tool-api-runtime')

const logger = { log() {} }
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-runtime-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const botManager = { workers: new Map(), get(name) { return this.workers.get(name) } }
  return { dir, botManager, checkpointFile: path.join(dir, 'checkpoints.json') }
}
function addWorker(manager, name) {
  const bot = Object.assign(new EventEmitter(), { health: 20, entity: { position: { x: 0, y: 64, z: 0 } }, inventory: { items: () => [] } })
  const controller = { bot, currentTask: null, isIdle: () => true, cancel() { this.currentTask = null }, runs: 0,
    async run() { this.runs++; return { ok: true } } }
  bot.colonyController = controller
  manager.workers.set(name, { name, role: 'ajudante', bot })
  return bot
}
async function call(runtime, suffix, body) {
  const port = runtime.server.server.address().port
  const response = await fetch(`http://127.0.0.1:${port}${suffix}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
  return { status: response.status, data: await response.json() }
}

test('disabled runtime does not read invalid checkpoints, attach tools or create files', async t => {
  const f = await fixture(t), bot = addWorker(f.botManager, 'a')
  await fs.writeFile(f.checkpointFile, '{broken')
  assert.equal(await startToolApiRuntime({ ...f, enabled: false, logger }), null)
  assert.equal(bot.minecraftTools, undefined)
  assert.equal(await fs.readFile(f.checkpointFile, 'utf8'), '{broken')
  assert.deepEqual(await fs.readdir(f.dir), ['checkpoints.json'])
})

test('runtime binds loopback, attaches existing and new workers, and removes disconnected layers', async t => {
  const f = await fixture(t), a = addWorker(f.botManager, 'a')
  const runtime = await startToolApiRuntime({ ...f, enabled: true, port: 0, logger })
  t.after(() => runtime.close())
  assert.equal(runtime.server.server.address().address, '127.0.0.1')
  assert.ok(a.minecraftTools)
  const b = addWorker(f.botManager, 'b')
  runtime.attach(b, 'b')
  assert.equal((await call(runtime, '/v1/workers')).data.length, 2)
  assert.equal((await call(runtime, '/v1/workers/b/state')).data.worker, 'b')
  b.emit('end')
  assert.equal(b.minecraftTools, undefined)
  assert.equal((await call(runtime, '/v1/workers/b/state')).status, 404)
})

test('completed checkpoint replays after runtime restart without physical re-execution', async t => {
  const f = await fixture(t), bot = addWorker(f.botManager, 'a')
  let runtime = await startToolApiRuntime({ ...f, enabled: true, port: 0, logger })
  const request = { task_id: 'move-1', args: { position: { x: 2, y: 64, z: 0 } } }
  const first = await call(runtime, '/v1/workers/a/tools/move_to', request)
  assert.equal(first.data.success, true)
  assert.equal(bot.colonyController.runs, 1)
  await runtime.close()
  assert.equal(bot.minecraftTools, undefined)
  assert.equal(bot.listenerCount('end'), 0)
  runtime = await startToolApiRuntime({ ...f, enabled: true, port: 0, logger })
  t.after(() => runtime.close())
  const replay = await call(runtime, '/v1/workers/a/tools/move_to', request)
  assert.equal(replay.data.replayed, true)
  assert.equal(bot.colonyController.runs, 1)
  const stored = JSON.parse(await fs.readFile(f.checkpointFile, 'utf8'))
  assert.equal(stored.tasks['move-1'].status, 'completed')
})

test('invalid checkpoint fails closed and preserves file and worker', async t => {
  const f = await fixture(t), bot = addWorker(f.botManager, 'a')
  await fs.writeFile(f.checkpointFile, '{broken')
  await assert.rejects(startToolApiRuntime({ ...f, enabled: true, port: 0, logger }), /checkpoints inválido/)
  assert.equal(bot.minecraftTools, undefined)
  assert.equal(await fs.readFile(f.checkpointFile, 'utf8'), '{broken')
})

test('HTTP preserves malformed IDs and args for validation before checkpoint or execution', async t => {
  const f = await fixture(t), bot = addWorker(f.botManager, 'a')
  const runtime = await startToolApiRuntime({ ...f, enabled: true, port: 0, logger })
  t.after(() => runtime.close())
  for (const task_id of [false, 0, '', [], {}]) {
    const result = await call(runtime, '/v1/workers/a/tools/move_to', { task_id, args: { position: { x: 2, y: 64, z: 0 } } })
    assert.equal(result.status, 400)
    assert.equal(result.data.reason, 'invalid_task_id')
  }
  const result = await call(runtime, '/v1/workers/a/tools/stop', { args: false })
  assert.equal(result.data.reason, 'args_invalid')
  assert.equal(bot.colonyController.runs, 0)
  await assert.rejects(fs.access(f.checkpointFile))
})

test('occupied port fails without attaching layers or unhandled listener errors', async t => {
  const f = await fixture(t), bot = addWorker(f.botManager, 'a')
  const occupied = net.createServer()
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => occupied.close(resolve)))
  await assert.rejects(startToolApiRuntime({ ...f, enabled: true, port: occupied.address().port, logger }), { code: 'EADDRINUSE' })
  assert.equal(bot.minecraftTools, undefined)
})

test('shutdown cancels API-owned action, detaches tools, persists failure and closes HTTP', async t => {
  const f = await fixture(t), bot = addWorker(f.botManager, 'a')
  let finish, started
  const executing = new Promise(resolve => { started = resolve })
  bot.colonyController.taskVersion = 0
  bot.colonyController.run = async function () { this.taskVersion++; this.currentTask = { type: 'ir_local' }; started(); return new Promise(resolve => { finish = resolve }) }
  bot.colonyController.cancel = function () { this.taskVersion++; this.currentTask = null; finish?.({ ok: false, cancelled: true }) }
  const runtime = await startToolApiRuntime({ ...f, enabled: true, port: 0, logger })
  const port = runtime.server.server.address().port
  const request = call(runtime, '/v1/workers/a/tools/move_to', { task_id: 'pending', args: { position: { x: 2, y: 64, z: 0 } } }).catch(() => {})
  await executing
  await runtime.close()
  await request
  assert.equal(bot.minecraftTools, undefined)
  assert.equal(runtime.checkpointStore.get('pending').status, 'cancelled')
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`))
})
