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

test('new owner waits for in-flight preparation and stale queued owners cannot act', async () => {
  const worker = bareWorker()
  let release, start
  const started = new Promise(r => { start = r })
  const events = []
  worker.runDeterministicPreparation = async (_, cancelled) => {
    events.push('preparation_start'); start()
    await new Promise(r => { release = r })
    assert.equal(cancelled(), true)
    events.push('preparation_settled')
    return { ok: false, code: 'CANCELLED' }
  }
  worker.goToPoint = async p => { events.push(p.name); return { ok: true } }
  const first = worker.run({ type: 'preparar_combate_deterministico', objective: { type: 'explorar' } })
  await started
  const stale = worker.run({ type: 'ir_local', position: { name: 'stale_owner' } })
  const next = worker.run({ type: 'ir_local', position: { name: 'new_owner' } })
  await new Promise(r => setImmediate(r))
  assert.deepEqual(events, ['preparation_start'])
  release()
  assert.equal((await first).code, 'CANCELLED')
  assert.equal((await stale).code, 'CANCELLED')
  assert.equal((await next).ok, true)
  assert.deepEqual(events, ['preparation_start', 'preparation_settled', 'new_owner'])
})

test('missing objective remains an OBJECTIVE_REQUIRED result with a defined shadow task', async () => {
  const worker = bareWorker()
  let observed
  worker._observeShadow = task => { observed = task }
  const task = { type: 'preparar_combate_deterministico', allowedTargets: [] }
  const result = await worker.run(task)
  assert.equal(result.code, 'OBJECTIVE_REQUIRED')
  assert.equal(observed, task)
})

test('damage defense invalidates preparation immediately but waits before physical reaction', async () => {
  const { Vec3 } = require('vec3')
  const worker=bareWorker(),events=[]
  const threat={name:'zombie',type:'hostile',position:new Vec3(1,64,0),isValid:true}
  worker.bot.health=5;worker.bot.inventory={items:()=>[]};worker.bot.entities={z:threat}
  worker.logger={log(){}}
  worker.flee=async()=>{events.push('defense_physical')}
  let start,release
  const started=new Promise(r=>{start=r})
  worker.runDeterministicPreparation=async(_task,cancelled)=>{start();await new Promise(r=>{release=r});assert.equal(cancelled(),true);events.push('preparation_settled');return {ok:false,code:'CANCELLED'}}
  const preparing=worker.run({type:'preparar_combate_deterministico',objective:{type:'explorar'}})
  await started
  const defense=worker.defend(threat)
  await new Promise(r=>setImmediate(r));assert.equal(worker.defending,true);assert.deepEqual(events,[])
  release();await preparing;await defense
  assert.deepEqual(events,['preparation_settled','defense_physical'])
})


test('defense exposes a fresh preparation resume candidate without auto-running it', async () => {
  const { Vec3 } = require('vec3')
  const worker = bareWorker()
  worker.logger = { log() {} }
  worker.bot.inventory = { items: () => [] }
  worker.bot.entities = {}
  const threat = { name: 'zombie', type: 'hostile', position: new Vec3(1, 64, 0), isValid: true }
  const interrupted = {
    type: 'preparar_combate_deterministico',
    objective: { type: 'explorar', radius: 16 },
    allowedTargets: [{ x: 1, y: 64, z: 1, name: 'stone' }],
    timeoutMs: 12000
  }
  worker.currentTask = { ...interrupted }
  worker._preparationDrain = Promise.resolve({ ok: false, code: 'THREAT' })
  worker.flee = async () => {}
  let builtFrom = null
  let autoRuns = 0
  worker.buildPreparationResumeTask = task => {
    builtFrom = task
    return {
      type: 'preparar_combate_deterministico',
      objective: { ...task.objective },
      allowedTargets: task.allowedTargets.map(target => ({ ...target })),
      deterministicIntent: 'gather_materials'
    }
  }
  const originalRun = worker.run.bind(worker)
  worker.run = async task => { autoRuns++; return originalRun(task) }

  await worker.defend(threat)

  assert.equal(autoRuns, 0)
  assert.equal(builtFrom.type, 'preparar_combate_deterministico')
  assert.deepEqual(builtFrom.objective, interrupted.objective)
  assert.deepEqual(worker.pendingPreparationResume(), {
    type: 'preparar_combate_deterministico',
    objective: interrupted.objective,
    allowedTargets: interrupted.allowedTargets,
    deterministicIntent: 'gather_materials'
  })
})

test('any new owned task invalidates a pending preparation resume candidate', async () => {
  const worker = bareWorker()
  worker._preparationResumeCandidate = {
    type: 'preparar_combate_deterministico',
    objective: { type: 'explorar' },
    allowedTargets: [{ x: 1, y: 64, z: 1, name: 'stone' }]
  }
  worker.goToPoint = async () => ({ ok: true })

  const result = await worker.run({ type: 'ir_local', position: { x: 1, y: 64, z: 0 } })

  assert.equal(result.ok, true)
  assert.equal(worker.pendingPreparationResume(), null)
})
