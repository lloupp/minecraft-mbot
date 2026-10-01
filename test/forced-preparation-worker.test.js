const test = require('node:test')
const assert = require('node:assert/strict')
const { WorkerController } = require('../core/WorkerController')

function bareWorker() {
  const worker = Object.create(WorkerController.prototype)
  worker.taskVersion = 0
  worker.state = 'ocioso'
  worker.currentTask = null
  worker.bot = {
    food: 20,
    entity: { position: { x: 0, y: 64, z: 0 } },
    pathfinder: { setGoal() {} }
  }
  worker.workMoves = null
  worker.waitReady = async () => {}
  worker.useMoves = () => {}
  worker.leaveLeftoverPen = async () => {}
  worker._observeShadow = () => {}
  worker.cancel = function () {
    this.taskVersion++
    this.currentTask = null
  }
  return worker
}

test('deterministic preparation runs as an owned WorkerController task', async () => {
  const worker = bareWorker()
  let receivedTask = null
  let cancelledAtEntry = null

  worker.runDeterministicPreparation = async (task, isCancelled) => {
    receivedTask = task
    cancelledAtEntry = isCancelled()
    return { ok: true, executionAuthority: 'deterministic_opt_in', juliaExecutionAuthority: 'none' }
  }

  const task = {
    type: 'preparar_combate_deterministico',
    objective: { type: 'explorar' },
    allowedTargets: []
  }
  const result = await worker.run(task)

  assert.equal(cancelledAtEntry, false)
  assert.equal(receivedTask, task)
  assert.equal(result.ok, true)
  assert.equal(result.juliaExecutionAuthority, 'none')
})

test('a newer worker task cancels preparation through the normal taskVersion ownership', async () => {
  const worker = bareWorker()
  let release
  const started = new Promise((resolve) => {
    worker.runDeterministicPreparation = async (_task, isCancelled) => {
      resolve(isCancelled)
      await new Promise((done) => { release = done })
      return { ok: false, code: isCancelled() ? 'CANCELLED' : 'NOT_CANCELLED' }
    }
  })

  const first = worker.run({
    type: 'preparar_combate_deterministico',
    objective: { type: 'explorar' },
    allowedTargets: []
  })

  const isCancelled = await started
  assert.equal(isCancelled(), false)

  worker.cancel()
  assert.equal(isCancelled(), true)
  release()

  const result = await first
  assert.equal(result.code, 'CANCELLED')
})
