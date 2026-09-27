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
