const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { TaskCheckpointStore } = require('../core/TaskCheckpointStore')

async function tempFile(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mbot-checkpoint-'))
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }))
  return path.join(dir, 'tasks.json')
}

test('running task becomes interrupted after restart and never auto-completes', async t => {
  const file = await tempFile(t)
  const first = new TaskCheckpointStore(file)
  const task = first.create({ worker: 'miner-1', action: 'gather', args: { resource: 'oak_log', quantity: 6 } })
  first.start(task.id, { stateHash: 'abc' })
  await first.save()

  const second = new TaskCheckpointStore(file)
  await second.load()
  const [recovered] = second.recoverable('miner-1')
  assert.equal(recovered.id, task.id)
  assert.equal(recovered.status, 'interrupted')
  assert.equal(recovered.recoveryRequired, true)
})

test('terminal checkpoint cannot be started again', async t => {
  const store = new TaskCheckpointStore(await tempFile(t))
  const task = store.create({ worker: 'worker', action: 'stop' })
  store.start(task.id)
  store.finish(task.id, { success: true })
  assert.throws(() => store.start(task.id), /finalizado/)
})

test('checkpoint store preserves worker isolation', async t => {
  const store = new TaskCheckpointStore(await tempFile(t))
  const a = store.create({ worker: 'a', action: 'gather' })
  const b = store.create({ worker: 'b', action: 'craft' })
  store.start(a.id); store.interrupt(a.id)
  store.start(b.id); store.finish(b.id, { success: true })
  assert.deepEqual(store.recoverable('a').map(x => x.id), [a.id])
  assert.deepEqual(store.recoverable('b'), [])
})

test('corrupt checkpoint blocks overwrite', async t => {
  const file = await tempFile(t)
  await fs.promises.writeFile(file, '{broken', 'utf8')
  const store = new TaskCheckpointStore(file)
  await store.load()
  await assert.rejects(() => store.save(), err => err.code === 'CHECKPOINT_RECOVERY_REQUIRED')
})


test('checkpoint task id cannot be overwritten', async t => {
  const store = new TaskCheckpointStore(await tempFile(t))
  store.create({ id: 'same-id', worker: 'a', action: 'gather', args: { resource: 'oak_log' } })
  assert.throws(
    () => store.create({ id: 'same-id', worker: 'b', action: 'craft' }),
    err => err.code === 'TASK_ID_EXISTS'
  )
  assert.equal(store.get('same-id').worker, 'a')
})

for (const id of ['__proto__', 'constructor', 'toString']) {
  test(`prototype-shaped task id ${id} persists as an own record without prototype effects`, async t => {
    const file = await tempFile(t)
    const store = new TaskCheckpointStore(file)
    assert.equal(store.get(id), null)
    assert.throws(() => store.require(id), /não encontrado/)
    const originalPrototype = Object.getPrototypeOf(store.state.tasks)
    store.create({ id, worker: 'a', action: 'gather' })
    assert.equal(Object.hasOwn(store.state.tasks, id), true)
    assert.equal(Object.getPrototypeOf(store.state.tasks), originalPrototype)
    store.start(id)
    store.finish(id, { success: true })
    await store.save()
    const restored = new TaskCheckpointStore(file)
    await restored.load()
    assert.equal(restored.get(id).status, 'completed')
    assert.equal(restored.get(id).id, id)
    assert.equal(Object.getPrototypeOf(restored.state.tasks), null)
    assert.equal(Object.hasOwn(restored.state.tasks, id), true)
    assert.throws(() => restored.create({ id, worker: 'b', action: 'craft' }), error => error.code === 'TASK_ID_EXISTS')
    assert.equal(Object.prototype.status, undefined)
  })
}

test('explicit malformed task ids never silently become generated ids', async t => {
  const store = new TaskCheckpointStore(await tempFile(t))
  for (const id of ['', 0, false, {}, [], 'with space', 'a'.repeat(121)]) {
    assert.throws(() => store.create({ id, worker: 'a', action: 'stop' }), /task id inválido/)
  }
  assert.equal(Object.keys(store.snapshot().tasks).length, 0)
})

test('tool layer rejects malformed task ids before checkpoint lookup or execution', async () => {
  const { MinecraftToolLayer } = require('../core/MinecraftToolLayer')
  const layer = new MinecraftToolLayer({
    workerId: 'a',
    worker: { bot: { entity: {} }, isIdle: () => true, run() { assert.fail('invalid task id dispatched') } },
    logger: { log() {} },
    checkpointStore: { get() { assert.fail('invalid task id read checkpoint') } }
  })
  for (const task_id of ['', 0, false, {}, [], 'with space', 'a'.repeat(121)]) {
    const result = await layer.execute({ task_id, action: 'gather', args: { resource: 'oak_log', quantity: 1 } })
    assert.equal(result.success, false)
    assert.equal(result.rejected, true)
    assert.equal(result.reason, 'invalid_task_id')
  }
})
