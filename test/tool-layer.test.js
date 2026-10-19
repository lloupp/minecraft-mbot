const test = require('node:test')
const assert = require('node:assert/strict')
const { MinecraftToolLayer } = require('../core/MinecraftToolLayer')

function fixture(id = 'worker-a') {
  const items = [{ name: 'oak_log', count: 2 }]
  const worker = {
    bot: {
      health: 20, food: 18, game: { dimension: 'overworld' },
      entity: { position: { x: 1.9, y: 64, z: -2.1 } },
      inventory: { items: () => items },
      heldItem: null
    },
    currentTask: null,
    production: {},
    storage: { configured: () => true },
    isIdle: () => true,
    cancel() { this.currentTask = null },
    async eat() { return 'bread' },
    async run(task) {
      this.lastTask = task
      if (task.type === 'coletar_blocos') return { ok: true, verified: true, gathered: task.count }
      if (task.type === 'retirar_estoque') return { ok: true, withdrawn: task.count }
      return { ok: true }
    }
  }
  return { worker, layer: new MinecraftToolLayer({ worker, workerId: id, logger: { log() {} } }) }
}

test('state is compact and exposes dynamic actions', () => {
  const { layer } = fixture()
  const state = layer.state('get wood')
  assert.equal(state.worker, 'worker-a')
  assert.deepEqual(state.inventory, { oak_log: 2 })
  assert.ok(state.availableActions.includes('craft'))
  assert.ok(state.availableActions.includes('withdraw'))
})

test('rejects cross-worker decision', async () => {
  const { layer } = fixture('worker-a')
  const out = await layer.execute({ worker: 'worker-b', action: 'gather', args: { resource: 'oak_log', quantity: 1 } })
  assert.equal(out.rejected, true)
  assert.equal(out.reason, 'worker_mismatch')
})

test('rejects unknown tool and excessive quantity', async () => {
  const { layer } = fixture()
  assert.equal((await layer.execute({ action: 'bash', args: {} })).reason, 'unknown_action')
  assert.equal((await layer.execute({ action: 'gather', args: { resource: 'oak_log', quantity: 65 } })).reason, 'invalid_quantity')
})

test('maps high-level gather to deterministic worker task and verifies result', async () => {
  const { worker, layer } = fixture()
  const out = await layer.execute({ action: 'gather', args: { resource: 'oak_log', quantity: 6 } })
  assert.equal(out.success, true)
  assert.deepEqual(worker.lastTask, { type: 'coletar_blocos', resource: 'oak_log', count: 6 })
})

test('does not trust a completed call when gather evidence says unverified', async () => {
  const { worker, layer } = fixture()
  worker.run = async () => ({ ok: true, verified: false, gathered: 6 })
  const out = await layer.execute({ action: 'gather', args: { resource: 'oak_log', quantity: 6 } })
  assert.equal(out.success, false)
})

test('unconfigured capabilities are absent and rejected', async () => {
  const { worker, layer } = fixture()
  worker.production = null
  worker.storage = null
  assert.equal(layer.availableActions().includes('craft'), false)
  assert.equal((await layer.execute({ action: 'craft', args: { item: 'stick', quantity: 1 } })).reason, 'action_unavailable')
})

test('stop cancels current worker only', async () => {
  const a = fixture('a'), b = fixture('b')
  a.worker.currentTask = { type: 'explorar' }
  b.worker.currentTask = { type: 'fabricar' }
  await a.layer.execute({ worker: 'a', action: 'stop', args: {} })
  assert.equal(a.worker.currentTask, null)
  assert.deepEqual(b.worker.currentTask, { type: 'fabricar' })
})


test('mutating tool execution is checkpointed and terminalized', async () => {
  const { layer } = fixture('worker-a')
  const calls = []
  const store = {
    create(value) { calls.push(['create', value]); return { id: value.id || 'task-1', stateHash: value.stateHash } },
    start(id) { calls.push(['start', id]) },
    finish(id, result) { calls.push(['finish', id, result.success]) },
    async save() { calls.push(['save']) }
  }
  layer.checkpointStore = store
  const out = await layer.execute({ task_id: 'task-1', action: 'gather', args: { resource: 'oak_log', quantity: 1 } })
  assert.equal(out.success, true)
  assert.equal(out.task_id, 'task-1')
  assert.deepEqual(calls.map(x => x[0]), ['create', 'start', 'save', 'finish', 'save'])
})

test('read-only tools do not create checkpoints', async () => {
  const { layer } = fixture()
  layer.checkpointStore = { create() { assert.fail('read must not checkpoint') } }
  const out = await layer.execute({ action: 'get_state', args: {} })
  assert.equal(out.success, true)
})


test('repeated completed task_id replays result without re-execution', async () => {
  const { worker, layer } = fixture()
  let runs = 0
  worker.run = async () => { runs++; return { ok: true, verified: true, gathered: 1 } }
  const stored = {
    id: 'same-1', worker: 'worker-a', action: 'gather',
    args: { resource: 'oak_log', quantity: 1 },
    status: 'completed',
    result: { success: true, result: { ok: true, verified: true, gathered: 1 }, duration_ms: 5, task_id: 'same-1' }
  }
  layer.checkpointStore = { get: () => stored }
  const out = await layer.execute({ task_id: 'same-1', action: 'gather', args: { resource: 'oak_log', quantity: 1 } })
  assert.equal(out.success, true)
  assert.equal(out.replayed, true)
  assert.equal(runs, 0)
})

test('reused task_id with different request is rejected', async () => {
  const { worker, layer } = fixture()
  let runs = 0
  worker.run = async () => { runs++; return { ok: true } }
  layer.checkpointStore = {
    get: () => ({ id: 'same-2', worker: 'worker-a', action: 'gather', args: { resource: 'oak_log', quantity: 1 }, status: 'completed' })
  }
  const out = await layer.execute({ task_id: 'same-2', action: 'craft', args: { item: 'stick', quantity: 1 } })
  assert.equal(out.rejected, true)
  assert.equal(out.reason, 'task_id_conflict')
  assert.equal(runs, 0)
})

test('interrupted task_id requires recovery instead of automatic retry', async () => {
  const { worker, layer } = fixture()
  let runs = 0
  worker.run = async () => { runs++; return { ok: true } }
  layer.checkpointStore = {
    get: () => ({ id: 'same-3', worker: 'worker-a', action: 'gather', args: { resource: 'oak_log', quantity: 1 }, status: 'interrupted' })
  }
  const out = await layer.execute({ task_id: 'same-3', action: 'gather', args: { resource: 'oak_log', quantity: 1 } })
  assert.equal(out.rejected, true)
  assert.equal(out.reason, 'task_recovery_required')
  assert.equal(runs, 0)
})

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function checkpointGate(layer) {
  const gate = deferred()
  let saves = 0
  layer.checkpointStore = {
    create(value) { return { ...value, id: value.id || 'gated' } },
    start() {}, finish() {},
    save() { return ++saves === 1 ? gate.promise : Promise.resolve() }
  }
  return gate
}

const gatherDecision = { action: 'gather', args: { resource: 'oak_log', quantity: 1 } }

test('busy colony task is rejected without cancelling it or persisting a checkpoint', async () => {
  const { worker, layer } = fixture()
  worker.currentTask = { type: 'explorar' }
  worker.isIdle = () => false
  worker.cancel = () => assert.fail('busy action must not cancel colony')
  layer.checkpointStore = { create() { assert.fail('busy must not checkpoint') } }
  assert.equal((await layer.execute(gatherDecision)).reason, 'worker_busy')
  assert.equal(worker.currentTask.type, 'explorar')
})

test('checkpoint save reserves API execution and still permits reads', async () => {
  const { worker, layer } = fixture()
  let runs = 0
  worker.run = async () => { runs++; return { ok: true, verified: true, gathered: 1 } }
  const gate = checkpointGate(layer)
  const pending = layer.execute(gatherDecision)
  assert.equal((await layer.execute({ action: 'eat' })).reason, 'worker_busy')
  assert.equal((await layer.execute({ action: 'get_state' })).result.busy, true)
  assert.equal(runs, 0)
  gate.resolve()
  assert.equal((await pending).success, true)
  assert.equal(runs, 1)
})

test('stop during pending persistence aborts dispatch and keeps lock until drain', async () => {
  const { worker, layer } = fixture()
  worker.run = async () => assert.fail('stopped pending action must not run')
  const gate = checkpointGate(layer)
  const pending = layer.execute(gatherDecision)
  await layer.execute({ action: 'stop' })
  assert.equal((await layer.execute({ action: 'eat' })).reason, 'worker_busy')
  gate.resolve()
  assert.equal((await pending).reason, 'cancelled')
  assert.equal(layer._active, null)
})

test('external owner arriving during checkpoint save is preserved', async () => {
  const { worker, layer } = fixture()
  worker.taskVersion = 0
  worker.run = async () => assert.fail('must not replace external owner')
  const gate = checkpointGate(layer)
  const pending = layer.execute(gatherDecision)
  worker.taskVersion++
  worker.currentTask = { type: 'fabricar' }
  gate.resolve()
  assert.equal((await pending).reason, 'cancelled')
  assert.equal(worker.currentTask.type, 'fabricar')
})

test('eat holds the same execution lock as worker tasks', async () => {
  const { worker, layer } = fixture()
  const gate = deferred()
  worker.eat = () => gate.promise
  const pending = layer.execute({ action: 'eat' })
  assert.equal((await layer.execute(gatherDecision)).reason, 'worker_busy')
  gate.resolve('bread')
  assert.equal((await pending).success, true)
  assert.equal((await layer.execute(gatherDecision)).success, true)
})

test('late successful worker result after cancellation is not success', async () => {
  const { worker, layer } = fixture()
  worker.taskVersion = 4
  worker.cancel = function () { this.taskVersion++; this.currentTask = null }
  const gate = deferred()
  worker.run = function () { this.cancel(); return gate.promise }
  const pending = layer.execute(gatherDecision)
  await layer.execute({ action: 'stop' })
  gate.resolve({ ok: true, verified: true, gathered: 1 })
  assert.equal((await pending).reason, 'cancelled')
})

for (const event of ['end', 'death']) {
  test(`worker ${event} while executing cannot become success after respawn`, async () => {
    const { EventEmitter } = require('node:events')
    const { worker, layer } = fixture()
    worker.bot = Object.assign(new EventEmitter(), worker.bot)
    const gate = deferred()
    worker.run = () => gate.promise
    const pending = layer.execute(gatherDecision)
    worker.bot.emit(event)
    gate.resolve({ ok: true, verified: true, gathered: 1 })
    const result = await pending
    assert.equal(result.success, false)
    assert.equal(result.reason, event === 'end' ? 'worker_disconnected' : 'worker_dead')
    assert.equal(worker.bot.listenerCount(event), 0)
  })
}

test('initial checkpoint save failure returns failure, executes nothing, and releases reservation', async () => {
  const { worker, layer } = fixture()
  worker.run = async () => assert.fail('must not execute without checkpoint durability')
  const gate = checkpointGate(layer)
  const pending = layer.execute(gatherDecision)
  gate.reject(new Error('disk unavailable'))
  assert.equal((await pending).error, 'disk unavailable')
  assert.equal(layer._active, null)
})

test('native worker reservation blocks colony ownership while checkpoint save yields', async () => {
  const { worker, layer } = fixture()
  worker.taskVersion = 0
  worker.state = 'ocioso'
  worker.reserveTool = function () { this.reserved = { version: this.taskVersion }; return this.reserved }
  worker.ownsTool = function (token) { return this.reserved === token && token.version === this.taskVersion }
  worker.releaseTool = function (token) { if (this.reserved === token) this.reserved = null }
  worker.isIdle = function () { return !this.reserved }
  worker.run = async function (task, { canStart }) {
    assert.equal(canStart(), true)
    this.taskVersion++
    return { ok: true, verified: true, gathered: 1 }
  }
  const gate = checkpointGate(layer)
  const pending = layer.execute(gatherDecision)
  assert.equal(worker.isIdle(), false)
  gate.resolve()
  assert.equal((await pending).success, true)
  assert.equal(worker.isIdle(), true)
})

test('run start guard rejects late external ownership after readiness yields', async () => {
  const { worker, layer } = fixture()
  worker.taskVersion = 0
  const gate = deferred()
  worker.run = async function (task, { canStart }) {
    await gate.promise
    assert.equal(canStart(), false)
    return { ok: false, cancelled: true }
  }
  const pending = layer.execute(gatherDecision)
  worker.taskVersion++
  worker.currentTask = { type: 'explorar' }
  gate.resolve()
  const result = await pending
  assert.equal(result.success, false)
  assert.equal(worker.currentTask.type, 'explorar')
})

test('close aborts pending action and drains persistence, but allows reads', async () => {
  const { worker, layer } = fixture()
  worker.taskVersion = 0
  worker.cancel = function () { this.taskVersion++ }
  worker.run = () => assert.fail('closed pending action must not run')
  const gate = checkpointGate(layer)
  const pending = layer.execute(gatherDecision)
  const closed = layer.close()
  assert.equal((await layer.execute({ action: 'eat' })).reason, 'tool_layer_closed')
  assert.equal((await layer.execute({ action: 'get_state' })).success, true)
  gate.resolve()
  assert.equal((await pending).reason, 'cancelled')
  await closed
})

test('close does not cancel a newer colony task that preempted API execution', async () => {
  const { worker, layer } = fixture()
  worker.taskVersion = 0
  const gate = deferred()
  worker.run = function () { this.taskVersion++; return gate.promise }
  const pending = layer.execute(gatherDecision)
  worker.taskVersion++
  worker.currentTask = { type: 'explorar' }
  worker.cancel = () => assert.fail('close must preserve newer task')
  const closed = layer.close()
  gate.resolve({ ok: true, verified: true, gathered: 1 })
  assert.equal((await pending).success, false)
  await closed
  assert.equal(worker.currentTask.type, 'explorar')
})

test('close preserves external owner acquired while native run waits for readiness', async () => {
  const { worker, layer } = fixture()
  worker.taskVersion = 0
  worker.reserveTool = function () { this.reserved = { version: this.taskVersion }; return this.reserved }
  worker.ownsTool = function (token) { return this.reserved === token && token.version === this.taskVersion }
  worker.releaseTool = function () { this.reserved = null }
  const gate = deferred()
  worker.run = async function (task, { canStart }) { await gate.promise; assert.equal(canStart(), false); return { ok: false } }
  const pending = layer.execute(gatherDecision)
  worker.taskVersion++
  worker.currentTask = { type: 'explorar' }
  worker.cancel = () => assert.fail('waiting API must not cancel new owner')
  const closed = layer.close()
  gate.resolve()
  assert.equal((await pending).success, false)
  await closed
  assert.equal(worker.currentTask.type, 'explorar')
})
