const test = require('node:test')
const assert = require('node:assert/strict')
const { WorkerController } = require('../core/WorkerController')

function deferred() {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}

function workerFixture() {
  const worker = Object.create(WorkerController.prototype)
  Object.assign(worker, {
    state: 'ocioso', currentTask: null, taskVersion: 0,
    bot: { entity: {}, health: 20, food: 20, pathfinder: { setGoal() {} } },
    waitReady: async () => {}, useMoves() {},
    leaveLeftoverPen: async () => {}, _observeShadow() {}
  })
  return worker
}

test('native reservation excludes idle colony scheduling and release restores idle', () => {
  const worker = workerFixture()
  const token = worker.reserveTool()
  assert.ok(token)
  assert.equal(worker.isIdle(), false)
  assert.equal(worker.reserveTool(), null)
  assert.equal(worker.ownsTool(token), true)
  worker.releaseTool({ version: 0 })
  assert.equal(worker.isIdle(), false)
  worker.releaseTool(token)
  assert.equal(worker.isIdle(), true)
})

test('cancel invalidates native reservation even when entity remains connected', () => {
  const worker = workerFixture()
  const token = worker.reserveTool()
  worker.cancel()
  assert.equal(worker.ownsTool(token), false)
  assert.equal(worker.isIdle(), true)
})

test('external run wins while tool run awaits readiness without being cancelled by stale tool', async () => {
  const worker = workerFixture()
  const ready = deferred(), crafting = deferred(), craftStarted = deferred()
  let waits = 0
  worker.waitReady = () => ++waits === 1 ? ready.promise : Promise.resolve()
  worker.craft = () => { craftStarted.resolve(); return crafting.promise }
  worker.gatherBlocks = () => assert.fail('stale API must never execute')
  const token = worker.reserveTool()
  const api = worker.run({ type: 'coletar_blocos', resource: 'oak_log', count: 1 }, { canStart: () => worker.ownsTool(token) })
  const colony = worker.run({ type: 'fabricar', item: 'stick', count: 1 })
  await craftStarted.promise
  const colonyVersion = worker.taskVersion
  assert.equal(worker.currentTask.type, 'fabricar')
  ready.resolve()
  assert.equal((await api).cancelled, true)
  assert.equal(worker.taskVersion, colonyVersion)
  assert.equal(worker.currentTask.type, 'fabricar')
  crafting.resolve({ ok: true })
  assert.equal((await colony).ok, true)
})
