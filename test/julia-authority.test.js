const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')

const { JuliaAuthority } = require('../lib/julia-authority')
const { WorkerController } = require('../core/WorkerController')
const { preparationDispatchTask } = require('../lib/forced-preparation')
const { candidateIntents } = require('../lib/player-loop')

const two = [
  { id: 'prepare_combat', description: 'craft a weapon first' },
  { id: 'continue_objective', description: 'keep exploring unarmed' }
]
const calmState = { health: 20, food: 20, time: 'day', threat: null, inventory: {} }

function memoryLog() {
  const rows = []
  return { rows, log: (type, data, worker) => rows.push({ type, data, worker }) }
}

function reply(body, { status = 200 } = {}) {
  return async () => ({ ok: status === 200, status, json: async () => body })
}

function authority(fetchImpl, extra = {}) {
  const eventLog = memoryLog()
  const auth = new JuliaAuthority({ endpoint: 'http://julia.test/choose', enabled: true, timeoutMs: 200, fetchImpl, eventLog, logger: { log() {} }, ...extra })
  return { auth, rows: eventLog.rows }
}

test('autoridade desligada por padrão: sem a flag (ou sem endpoint) enabled() é falso', () => {
  const previous = process.env.MBOT_JULIA_AUTHORITY
  delete process.env.MBOT_JULIA_AUTHORITY
  try {
    assert.equal(new JuliaAuthority({ endpoint: 'http://x/choose' }).enabled(), false)
    assert.equal(new JuliaAuthority({ enabled: true, endpoint: null }).enabled(), false)
    assert.equal(new JuliaAuthority({ enabled: true, endpoint: 'http://x/choose' }).enabled(), true)
  } finally {
    if (previous !== undefined) process.env.MBOT_JULIA_AUTHORITY = previous
  }
})

test('decisão válida da Julia vira a escolha executada (mesmo diferente da determinística)', async () => {
  let body = null
  const { auth, rows } = authority(async (_url, init) => { body = JSON.parse(init.body); return reply({ choice: 'continue_objective', confidence: 0.7 })() })
  const decision = await auth.decide({ state: calmState, candidates: two, meta: { worker: 'w' } })
  assert.equal(decision.choice, 'continue_objective')
  assert.equal(decision.source, 'julia')
  assert.deepEqual(body.candidates.map((c) => c.id), ['prepare_combat', 'continue_objective'])
  const row = rows.find((r) => r.type === 'julia_authority_decision').data
  assert.equal(row.deterministicChoice, 'prepare_combat')
  assert.equal(row.agreesWithDeterministic, false)
  assert.equal(row.validation, 'ok')
})

test('candidato único é forçado: a Julia não é consultada', async () => {
  let calls = 0
  const { auth } = authority(async () => { calls++; return reply({ choice: 'x' })() })
  const decision = await auth.decide({ state: calmState, candidates: [two[0]], meta: { worker: 'w' } })
  assert.equal(calls, 0)
  assert.equal(decision.source, 'forced')
  assert.equal(decision.choice, 'prepare_combat')
})

test('escolha fora dos candidatos é rejeitada e cai na determinística, registrando a tentativa', async () => {
  const { auth, rows } = authority(reply({ choice: 'dig_straight_down' }))
  const decision = await auth.decide({ state: calmState, candidates: two, meta: { worker: 'w' } })
  assert.equal(decision.source, 'fallback')
  assert.equal(decision.fallbackReason, 'invalid_choice')
  assert.equal(decision.choice, 'prepare_combat')
  const row = rows.find((r) => r.type === 'julia_authority_decision').data
  assert.equal(row.juliaChoice, 'dig_straight_down')
  assert.equal(row.validation, 'rejected')
  assert.equal(auth.stats.invalid, 1)
})

test('resposta malformada e HTTP de erro caem na determinística', async () => {
  for (const [fetchImpl, reason] of [[reply({ nope: 1 }), 'malformed_response'], [reply({}, { status: 500 }), 'http_500']]) {
    const { auth } = authority(fetchImpl)
    const decision = await auth.decide({ state: calmState, candidates: two, meta: { worker: 'w' } })
    assert.equal(decision.source, 'fallback')
    assert.equal(decision.fallbackReason, reason)
    assert.equal(decision.choice, 'prepare_combat')
  }
})

test('timeout da Julia cai na determinística dentro do prazo', async () => {
  const hang = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  })
  const { auth } = authority(hang, { timeoutMs: 50 })
  const started = Date.now()
  const decision = await auth.decide({ state: calmState, candidates: two, meta: { worker: 'w' } })
  assert.ok(Date.now() - started < 1000)
  assert.equal(decision.fallbackReason, 'timeout')
  assert.equal(decision.choice, 'prepare_combat')
  assert.equal(auth.stats.timeout, 1)
})

test('sidecar fora do ar cai na determinística; o disjuntor para de consultar depois de N falhas', async () => {
  let calls = 0
  const offline = async () => { calls++; throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) }
  const { auth, rows } = authority(offline, { breakerThreshold: 2, breakerCooldownMs: 60000 })
  const first = await auth.decide({ state: calmState, candidates: two, meta: { worker: 'w' } })
  assert.equal(first.fallbackReason, 'offline:ECONNREFUSED')
  await auth.decide({ state: calmState, candidates: two, meta: { worker: 'w' } })
  const third = await auth.decide({ state: calmState, candidates: two, meta: { worker: 'w' } })
  assert.equal(calls, 2)
  assert.equal(third.fallbackReason, 'breaker_open')
  assert.equal(third.choice, 'prepare_combat')
  assert.equal(rows.filter((r) => r.type === 'julia_authority_decision' && r.data.source === 'fallback').length, 3)
})

test('cancelamento durante a consulta aborta a requisição e não devolve escolha', async () => {
  let cancelled = false
  let aborted = false
  const hang = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => { aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
  })
  const { auth, rows } = authority(hang, { timeoutMs: 5000 })
  setTimeout(() => { cancelled = true }, 30)
  const decision = await auth.decide({ state: calmState, candidates: two, isCancelled: () => cancelled, meta: { worker: 'w' } })
  assert.equal(aborted, true)
  assert.equal(decision.cancelled, true)
  assert.equal(decision.choice, null)
  assert.ok(rows.some((r) => r.type === 'julia_authority_cancelled'))
  assert.equal(auth.stats.fallback, 0)
})

test('guardrail de segurança: escolha que o player loop marca como violação cai na determinística', async () => {
  const threatened = { ...calmState, threat: { type: 'zombie', distance: 6 }, inventory: {} }
  const options = [{ id: 'escape_danger', description: 'flee' }, { id: 'fight_threat', description: 'fight' }]
  const { auth } = authority(reply({ choice: 'fight_threat' }))   // desarmado: luta é violação
  const decision = await auth.decide({ state: threatened, candidates: options, meta: { worker: 'w' } })
  assert.equal(decision.source, 'fallback')
  assert.equal(decision.fallbackReason, 'safety_violation')
  assert.equal(decision.choice, 'escape_danger')
})

test('settle fecha o ciclo com ação, resultado e novo estado; decisão não fechada não some', async () => {
  const { auth, rows } = authority(reply({ choice: 'continue_objective' }))
  await auth.decide({ state: calmState, candidates: two, meta: { worker: 'w' } })
  auth.settle('w', { action: 'explore', result: { ok: true, x: 10, z: 20 }, nextState: { ...calmState, food: 19 } })
  const cycle = rows.find((r) => r.type === 'julia_authority_cycle').data
  assert.equal(cycle.choice, 'continue_objective')
  assert.equal(cycle.action, 'explore')
  assert.deepEqual(cycle.result.exploredTo, { x: 10, z: 20 })
  assert.equal(cycle.nextState.food, 19)

  await auth.decide({ state: calmState, candidates: two, meta: { worker: 'w' } })
  await auth.decide({ state: calmState, candidates: two, meta: { worker: 'w' } })   // a anterior nunca foi fechada
  const notSettled = rows.filter((r) => r.type === 'julia_authority_cycle').at(-1).data
  assert.equal(notSettled.result.code, 'NOT_SETTLED')
})

test('executor: a intenção autorizada só vale enquanto ainda for candidata no estado atual', () => {
  const night = {
    health: 20, food: 20, time: 'night', threat: null, atBase: false, baseKnown: true,
    inventory: { cobblestone: 2, stick: 1 }, craftable: ['stone_sword'], nearby: { craftingTable: true },
    objective: { type: 'explore' }
  }
  const ids = candidateIntents(night).map((c) => c.id)
  assert.ok(ids.includes('return_base') && ids.includes('prepare_combat'), `candidatos: ${ids}`)
  const objective = { type: 'explorar' }
  assert.equal(preparationDispatchTask({ enabled: true, state: night, objective }), null)   // determinística: return_base
  const task = preparationDispatchTask({ enabled: true, state: night, objective, authorizedIntent: 'prepare_combat' })
  assert.equal(task.deterministicIntent, 'prepare_combat')
  assert.equal(task.authorizedIntent, 'prepare_combat')
  // Intenção que não está entre os candidatos não cria ação: volta à determinística.
  assert.equal(preparationDispatchTask({ enabled: true, state: night, objective, authorizedIntent: 'gather_materials' }), null)
})

function loopWorker(authority) {
  const worker = Object.create(WorkerController.prototype)
  worker.name = 'explorer-test'
  worker.taskVersion = 1
  worker.homeProvider = () => new Vec3(0, 64, 0)
  worker.logger = { log() {} }
  worker._preparationDrain = null
  worker.juliaAuthority = authority
  worker.bot = {
    health: 20, food: 20, time: { timeOfDay: 1000 }, entity: { position: new Vec3(5, 64, 0) }, entities: {},
    heldItem: null, nearestEntity: () => null, inventory: { items: () => [{ name: 'stone_sword', count: 1 }], slots: [] },
    registry: { blocksArray: [], blocksByName: {}, items: {} },
    findBlocks: () => [], blockAt: (position) => ({ name: 'air', position }), canDigBlock: () => true, canSeeBlock: () => true,
    pathfinder: { bestHarvestTool: () => null }
  }
  worker.production = { storage: { configured: () => false }, cachedCraftingTable: () => null }
  return worker
}

function withFlags(fn) {
  const saved = { e: process.env.MBOT_EXPLORE_PREPARATION, d: process.env.MBOT_DETERMINISTIC_PREPARATION }
  process.env.MBOT_EXPLORE_PREPARATION = '1'
  process.env.MBOT_DETERMINISTIC_PREPARATION = '1'
  return Promise.resolve().then(fn).finally(() => {
    for (const [key, env] of [['e', 'MBOT_EXPLORE_PREPARATION'], ['d', 'MBOT_DETERMINISTIC_PREPARATION']]) {
      if (saved[key] === undefined) delete process.env[env]
      else process.env[env] = saved[key]
    }
  })
}

test('player loop: com autoridade, a escolha da Julia tem consequência física e o ciclo é registrado', () => withFlags(async () => {
  // Espada no inventário, não equipada: candidatos [equip_best_weapon, continue_objective]; determinística = equipar.
  const { auth, rows } = authority(reply({ choice: 'continue_objective' }))
  const worker = loopWorker(auth)
  let explored = 0
  worker.runDeterministicPreparation = async () => assert.fail('a escolha determinística (equipar) não deve rodar')
  worker.explore = async () => { explored++; return { ok: true, x: 40, z: 0 } }
  const result = await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
  assert.equal(explored, 1)
  assert.equal(result.ok, true)
  const decision = rows.find((r) => r.type === 'julia_authority_decision').data
  assert.deepEqual(decision.candidates, ['equip_best_weapon', 'continue_objective'])
  assert.equal(decision.deterministicChoice, 'equip_best_weapon')
  const cycle = rows.find((r) => r.type === 'julia_authority_cycle').data
  assert.equal(cycle.source, 'julia')
  assert.equal(cycle.action, 'explore')
  assert.ok(cycle.nextState)
}))

test('player loop: Julia fora do ar → executa a determinística (equipar) pelo executor e registra o fallback', () => withFlags(async () => {
  const { auth, rows } = authority(async () => { throw new TypeError('fetch failed') })
  const worker = loopWorker(auth)
  let prepared = 0
  worker.runDeterministicPreparation = async (task) => {
    prepared++
    assert.equal(task.authorizedIntent, undefined)          // fallback não carrega autorização da Julia
    worker.bot.heldItem = { name: 'stone_sword' }
    return { ok: true }
  }
  worker.explore = async () => ({ ok: true, x: 1, z: 1 })
  await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
  assert.equal(prepared, 1)
  const cycles = rows.filter((r) => r.type === 'julia_authority_cycle').map((r) => r.data)
  assert.equal(cycles[0].source, 'fallback')
  assert.equal(cycles[0].action, 'preparation:equip_best_weapon')
}))

test('player loop: cancelamento durante a consulta à Julia não executa nada', () => withFlags(async () => {
  let cancelled = false
  const hang = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  })
  const { auth } = authority(hang, { timeoutMs: 5000 })
  const worker = loopWorker(auth)
  worker.runDeterministicPreparation = async () => assert.fail('nothing physical after cancellation')
  worker.explore = async () => assert.fail('nothing physical after cancellation')
  setTimeout(() => { cancelled = true }, 30)
  const result = await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => cancelled)
  assert.equal(result.code, 'CANCELLED')
}))

test('player loop sem autoridade: comportamento determinístico idêntico (nenhuma consulta)', () => withFlags(async () => {
  for (const authority of [null, new JuliaAuthority({ endpoint: 'http://x/choose', enabled: false, fetchImpl: async () => assert.fail('no call') })]) {
    const worker = loopWorker(authority)
    let prepared = 0
    worker.runDeterministicPreparation = async () => { prepared++; worker.bot.heldItem = { name: 'stone_sword' }; return { ok: true } }
    worker.explore = async () => ({ ok: true, x: 1, z: 1 })
    await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
    assert.equal(prepared, 1)
  }
}))

test('player loop: escolha da Julia sob ameaça (lutar x fugir) vai para os executores existentes', () => withFlags(async () => {
  const combat = require('../lib/combat')
  const original = combat.fight
  for (const pick of ['fight_threat', 'escape_danger']) {
    const { auth, rows } = authority(reply({ choice: pick }))
    const worker = loopWorker(auth)
    const zombie = { name: 'zombie', type: 'hostile', position: new Vec3(9, 64, 0), health: 20 }
    worker.bot.heldItem = { name: 'stone_sword' }                       // armado: candidatos [fight_threat, escape_danger]
    worker.bot.nearestEntity = (match) => (match(zombie) ? zombie : null)
    worker.bot.entities = { 1: zombie }
    worker.bot.pathfinder.setGoal = () => {}
    const done = []
    combat.fight = async () => { done.push('fight'); return 'morto' }
    worker.flee = async () => { done.push('flee') }
    try {
      const result = await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
      assert.equal(result.threatHandled, pick)
      assert.deepEqual(done, [pick === 'fight_threat' ? 'fight' : 'flee'])
      const decision = rows.find((r) => r.type === 'julia_authority_decision').data
      assert.deepEqual(decision.candidates, ['fight_threat', 'escape_danger'])
      assert.equal(rows.find((r) => r.type === 'julia_authority_cycle').data.action, `threat:${pick}:${pick === 'fight_threat' ? 'morto' : 'fugi'}`)
    } finally { combat.fight = original }
  }
}))

test('player loop: com fome, a escolha find_food da Julia caça com o executor de comida existente e come', () => withFlags(async () => {
  const food = require('../lib/food')
  const original = food.gatherFood
  const { auth, rows } = authority(reply({ choice: 'find_food' }))
  const worker = loopWorker(auth)
  worker.bot.inventory.items = () => []
  worker.bot.food = 6
  worker.bot.entity.position = new Vec3(20, 64, 0)        // fora da base: return_base continua opção
  const cow = { name: 'cow', type: 'passive', position: new Vec3(30, 64, 0) }
  worker.bot.entities = { 1: cow }
  worker.builtPens = () => []
  let hunted = 0, ate = 0
  food.gatherFood = async () => { hunted++; return 'cacei um(a) cow' }
  worker.eat = async () => { ate++; return 'beef' }
  worker.returnHome = async () => assert.fail('a escolha da Julia foi find_food')
  try {
    const result = await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
    assert.equal(result.ok, true)
    assert.equal(hunted, 1)
    assert.equal(ate, 1)
    const decision = rows.find((r) => r.type === 'julia_authority_decision').data
    assert.deepEqual(decision.candidates, ['find_food', 'return_base'])
    assert.equal(rows.find((r) => r.type === 'julia_authority_cycle').data.action, 'find_food:got+ate')
  } finally { food.gatherFood = original }
}))
