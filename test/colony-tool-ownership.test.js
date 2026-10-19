const test = require('node:test')
const assert = require('node:assert/strict')
const { ColonyOrchestrator } = require('../core/ColonyOrchestrator')
const { WorkerController } = require('../core/WorkerController')
const { MinecraftToolLayer } = require('../core/MinecraftToolLayer')

function deferred() {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}
function fixture() {
  const controller = Object.create(WorkerController.prototype)
  Object.assign(controller, {
    state: 'ocioso', currentTask: null, taskVersion: 0,
    bot: { health: 20, food: 20, entity: {}, inventory: { items: () => [] }, pathfinder: { setGoal() {} } },
    waitReady: async () => {}, useMoves() {}, leaveLeftoverPen: async () => {}, _observeShadow() {}
  })
  const worker = { name: 'a', bot: { colonyController: controller } }
  const colony = new ColonyOrchestrator({ botManager: {}, logger: { log() {} } })
  return { worker, controller, colony }
}

test('queued automatic task cannot cancel API reservation taken before dispatch', async () => {
  const { worker, controller, colony } = fixture()
  const saved = deferred()
  const layer = new MinecraftToolLayer({ worker: controller, workerId: 'a', logger: { log() {} }, checkpointStore: {
    create() { return { id: 'api', stateHash: 's' } }, start() {}, finish() {},
    save() { return saved.promise }
  } })
  controller.gatherBlocks = () => assert.fail('queued automatic task must not execute')
  controller.goToPoint = async () => ({ ok: true })
  const auto = colony.runAuto(worker, controller, { type: 'coletar_blocos', resource: 'oak_log', count: 1 })
  const api = layer.execute({ action: 'move_to', args: { position: { x: 1, y: 64, z: 0 } } })
  const token = controller._toolReservation
  assert.ok(token)
  await auto
  assert.equal(controller.ownsTool(token), true)
  assert.equal(controller.taskVersion, 0)
  assert.equal(colony.autoFailures.has('a'), false)
  assert.equal(colony.autoInFlight.has('a'), false)
  saved.resolve()
  assert.equal((await api).success, true)
})

test('automatic run readiness rechecks ownership after external command starts', async () => {
  const { worker, controller, colony } = fixture()
  const ready = deferred(), moved = deferred(), moveStarted = deferred()
  let waits = 0
  controller.waitReady = () => ++waits === 1 ? ready.promise : Promise.resolve()
  controller.gatherBlocks = () => assert.fail('stale automatic task must not execute')
  controller.goToPoint = () => { moveStarted.resolve(); return moved.promise }
  const auto = colony.runAuto(worker, controller, { type: 'coletar_blocos', resource: 'oak_log', count: 1 })
  await Promise.resolve()
  const command = controller.run({ type: 'ir_local', position: { x: 1, y: 64, z: 0 } })
  await moveStarted.promise
  const version = controller.taskVersion
  ready.resolve()
  await auto
  assert.equal(controller.currentTask.type, 'ir_local')
  assert.equal(controller.taskVersion, version)
  assert.equal(colony.autoFailures.has('a'), false)
  moved.resolve({ ok: true })
  await command
})

test('automatic dispatch still executes when idle ownership stays unchanged', async () => {
  const { worker, controller, colony } = fixture()
  let gathered = 0
  controller.gatherBlocks = async () => { gathered++; return { ok: true } }
  await colony.runAuto(worker, controller, { type: 'coletar_blocos', resource: 'oak_log', count: 1 })
  assert.equal(gathered, 1)
  assert.equal(controller.currentTask, null)
  assert.equal(colony.autoInFlight.size, 0)
})

test('stop holds automatic scheduler until cancelled native craft actually drains, without blocking another worker', async () => {
  const a = fixture(), b = fixture()
  b.worker.name = 'b'
  const gate = deferred(), started = deferred()
  a.controller.production = {
    async craftToStorage() { started.resolve(); await gate.promise; return { ok: true } }
  }
  const layerA = new MinecraftToolLayer({ worker: a.controller, workerId: 'a', logger: { log() {} } })
  const layerB = new MinecraftToolLayer({ worker: b.controller, workerId: 'b', logger: { log() {} } })
  a.colony.controllers = () => [
    { worker: a.worker, controller: a.controller },
    { worker: b.worker, controller: b.controller }
  ]
  let aRuns = 0
  a.controller.gatherBlocks = async () => { aRuns++; return { ok: true } }
  b.controller.goToPoint = async () => ({ ok: true })
  const crafting = layerA.execute({ action: 'craft', args: { item: 'stick', quantity: 1 } })
  await started.promise
  assert.equal((await layerA.execute({ action: 'stop' })).success, true)
  assert.equal(a.controller.currentTask, null)
  assert.equal(a.controller._toolReservation, null)
  assert.equal(a.controller.isIdle(), false)
  assert.deepEqual(a.colony.eligibleAutoControllers().map(entry => entry.worker.name), ['b'])
  a.colony.auto = true
  a.colony.autoReadiness = () => ({ ready: true })
  a.colony.storage = { snapshotFresh: () => true, cachedSummary: () => ({}) }
  a.colony.demandPlanner = { buildPlan: eligible => ({ report: {}, plan: eligible.filter(entry => entry.worker.name === 'a').map(entry => ({ ...entry, task: { type: 'coletar_blocos', resource: 'oak_log', count: 1 } })) }) }
  await a.colony.tick()
  await Promise.resolve()
  assert.equal(aRuns, 0)
  await a.colony.runAuto(a.worker, a.controller, { type: 'coletar_blocos', resource: 'oak_log', count: 1 })
  assert.equal(aRuns, 0)
  assert.equal((await layerB.execute({ action: 'move_to', args: { position: { x: 1, y: 64, z: 0 } } })).success, true)
  gate.resolve()
  assert.equal((await crafting).reason, 'cancelled')
  assert.equal(a.controller._toolDrain, null)
  assert.equal(a.controller.isIdle(), true)
  a.colony.autoBackoff.delete('a')
  await a.colony.runAuto(a.worker, a.controller, { type: 'coletar_blocos', resource: 'oak_log', count: 1 })
  assert.equal(aRuns, 1)
})

test('drain keeps cancelled API isolated while explicit command can still preempt it', async () => {
  const { controller } = fixture()
  const craftGate = deferred(), craftStarted = deferred()
  controller.production = { async craftToStorage() { craftStarted.resolve(); await craftGate.promise; return { ok: true } } }
  const moveGate = deferred(), moveStarted = deferred()
  controller.goToPoint = () => { moveStarted.resolve(); return moveGate.promise }
  const layer = new MinecraftToolLayer({ worker: controller, workerId: 'a', logger: { log() {} } })
  const crafting = layer.execute({ action: 'craft', args: { item: 'stick', quantity: 1 } })
  await craftStarted.promise
  const command = controller.run({ type: 'ir_local', position: { x: 1, y: 64, z: 0 } })
  await moveStarted.promise
  craftGate.resolve()
  assert.equal((await crafting).reason, 'cancelled')
  assert.equal(controller.currentTask.type, 'ir_local')
  assert.equal(controller._toolDrain, null)
  assert.equal(controller.isIdle(), false)
  moveGate.resolve({ ok: true })
  await command
  assert.equal(controller.isIdle(), true)
})
