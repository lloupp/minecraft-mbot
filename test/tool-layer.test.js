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
