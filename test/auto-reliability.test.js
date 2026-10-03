const test = require('node:test')
const assert = require('node:assert/strict')
const { ColonyOrchestrator } = require('../core/ColonyOrchestrator')
const { DemandPlanner } = require('../core/DemandPlanner')
const entry = (name, role) => ({ worker: { name, role }, controller: { isIdle: () => true } })
const colony = () => new ColonyOrchestrator({ logger: { log() {} } })

test('produção aguarda insumos coletados e lingotes disponíveis', () => {
  const planner = new DemandPlanner()
  const workers = [entry('miner', 'minerador'), entry('wood', 'lenhador'), entry('a', 'artesao'), entry('b', 'artesao')]
  assert.equal(planner.buildPlan(workers, { raw_iron: 8 }).plan.some(({ task }) => task.type === 'fabricar'), false)
  const { plan } = planner.buildPlan(workers, { raw_iron: 8, coal: 1, oak_log: 2 })
  assert.deepEqual(plan.filter(({ task }) => task.type === 'fabricar').map(({ task }) => task.item), ['iron_ingot'])
})

test('artesãos reservam combustível entre tarefas do mesmo ciclo', () => {
  const { plan } = new DemandPlanner().buildPlan([entry('a', 'artesao'), entry('b', 'artesao')], { raw_iron: 20, coal: 1 })
  assert.equal(plan.length, 1)
  assert.equal(plan[0].task.count, 8)
})

test('reserva do worker impede despacho duplicado antes de run iniciar', async () => {
  const c = colony()
  let finish
  let calls = 0
  const controller = { run: () => { calls++; return new Promise(resolve => { finish = resolve }) } }
  const first = c.runAuto({ name: 'worker' }, controller, { type: 'depositar' })
  c.runAuto({ name: 'worker' }, controller, { type: 'depositar' })
  await Promise.resolve()
  assert.equal(calls, 1)
  finish({ ok: true })
  await first
  assert.equal(c.autoInFlight.size, 0)
})

test('falhas síncronas liberam reservas e espera cresce até sucesso', async () => {
  const c = colony()
  const worker = { name: 'worker' }
  const task = { type: 'capturar_animais', species: 'cow' }
  const controller = { run() { throw new Error('sem caminho') } }
  await c.runAuto(worker, controller, task)
  const first = c.autoBackoff.get(worker.name)
  await c.runAuto(worker, controller, task)
  assert.ok(c.autoBackoff.get(worker.name) >= first + 20000)
  assert.equal(c.autoInFlight.size, 0)
  assert.equal(c.animalInFlight.size, 0)
  await c.runAuto(worker, { run: async () => ({ ok: true }) }, task)
  assert.equal(c.autoFailures.size, 0)
  assert.equal(c.autoBackoff.size, 0)
})

test('snapshot vencido dispara apenas uma sincronização entre workers', async () => {
  const c = colony()
  let finish
  let calls = 0
  const controller = { isIdle: () => true, run: () => { calls++; return new Promise(resolve => { finish = resolve }) } }
  c.botManager = { workers: new Map(['a', 'b'].map(name => [name, { name, bot: { colonyController: controller } }])) }
  c.homeProvider = () => ({ x: 0, y: 64, z: 0 })
  c.storage = { configured: () => true, snapshotFresh: () => false }
  c.demandPlanner = new DemandPlanner()
  c.setAuto(true)
  await c.tick()
  await c.tick()
  assert.equal(calls, 1)
  finish({ ok: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(c.autoInFlight.size, 0)
})

test('projeto com etapa que esgotou tentativas não é concluído', () => {
  const { ProjectManager } = require('../core/ProjectManager')
  const manager = new ProjectManager({ storage: { configured: () => true }, homeProvider: () => ({ x: 0, y: 64, z: 0 }) })
  manager.startBlueprint({ name: 'cabana', origin: { x: 0, y: 64, z: 0 }, regions: [{ materials: { stone: 1 } }] })
  const workers = [entry('builder', 'construtor')]
  for (let attempt = 0; attempt < 4; attempt++) {
    const [{ task }] = manager.planActions(workers, { stock: { stone: 1 } })
    manager.completeAction(task.projectActionId, { ok: false, remaining: { stone: 1 }, failed: 1 })
  }
  assert.equal(manager.active.actions[0].status, 'falhou')
  assert.equal(manager.maybeComplete({ deficits: {} }), false)
  assert.equal(manager.history.length, 0)
})

test('interrupção (cancelamento, preempção do player loop) não escala o backoff nem encurta o de falha real; falha real escala', async () => {
  const c = colony()
  const worker = { name: 'worker' }
  const task = { type: 'explorar' }
  for (const result of [{ ok: false, cancelled: true }, { ok: false, code: 'CANCELLED' }, { ok: false, code: 'PLAYER_LOOP_PREEMPTED' }]) {
    await c.runAuto(worker, { run: async () => result }, task)
    assert.equal(c.autoFailures.size, 0)
    const wait = c.autoBackoff.get(worker.name) - Date.now()
    assert.ok(wait > 0 && wait <= 5000)
  }
  await c.runAuto(worker, { run: async () => ({ ok: false, code: 'TIMEOUT' }) }, task)
  assert.equal(c.autoFailures.get(worker.name), 1)
  // uma interrupção não encurta o backoff já escalado por falhas reais
  const farFuture = Date.now() + 120000
  c.autoBackoff.set(worker.name, farFuture)
  await c.runAuto(worker, { run: async () => ({ ok: false, cancelled: true }) }, task)
  assert.equal(c.autoBackoff.get(worker.name), farFuture)
})
