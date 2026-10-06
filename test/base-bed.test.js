const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')

const { candidateIntents } = require('../lib/player-loop')
const bed = require('../lib/bed')
const { WorkerController } = require('../core/WorkerController')
const { JuliaAuthority } = require('../lib/julia-authority')

const ids = (state) => candidateIntents(state).map((c) => c.id)
const calmDay = (extra = {}) => ({
  health: 20, food: 20, time: 'day', threat: null, equippedWeapon: 'stone_sword', inventory: { stone_sword: 1 },
  atBase: false, baseKnown: true, baseDistance: 30, nearby: {}, objective: { type: 'explore' }, ...extra
})

test('comida comível do runtime (carne crua) conta como comida; sem o campo, a lista antiga vale', () => {
  const hungry = calmDay({ food: 7, inventory: { stone_sword: 1, beef: 3 }, nearby: { food: true, foodDistance: 10 } })
  assert.ok(ids(hungry).includes('find_food'))                         // Gauntlet: carne crua não está na lista
  assert.ok(!ids({ ...hungry, edibleFood: 3 }).includes('find_food'))  // runtime: carrega comida, não procura
  assert.ok(ids({ ...hungry, edibleFood: 0 }).includes('find_food'))
})

test('noite armado: com abrigo executável informado, abrigar-se vira opção (continuar também); sem o campo, igual', () => {
  const night = calmDay({ time: 'night' })
  assert.deepEqual(ids(night), ['continue_objective'])
  assert.deepEqual(ids({ ...night, shelterNearby: false }), ['continue_objective'])
  assert.deepEqual(ids({ ...night, shelterNearby: true, shelterKind: 'dig' }), ['sleep_or_shelter', 'continue_objective'])
  const described = candidateIntents({ ...night, shelterNearby: true, shelterKind: 'dig' })
  assert.match(described[0].description, /dig a 3-block hole right here/)
  assert.match(described[1].description, /It is night/)
})

test('make_bed: só com os campos do runtime, base sem cama e caminho real (material ou ovelha à vista)', () => {
  assert.ok(!ids(calmDay()).includes('make_bed'))                                          // Gauntlet
  assert.ok(!ids(calmDay({ baseHasBed: false, bedMaterials: false, nearby: { sheep: false } })).includes('make_bed'))
  assert.deepEqual(ids(calmDay({ baseHasBed: false, bedMaterials: false, nearby: { sheep: true, sheepDistance: 20 } })),
    ['make_bed', 'continue_objective'])
  assert.ok(!ids(calmDay({ baseHasBed: true, bedMaterials: true })).includes('make_bed'))
  const zombie = { type: 'zombie', distance: 10 }
  assert.ok(!ids(calmDay({ baseHasBed: false, bedMaterials: true, threat: zombie })).includes('make_bed'))
  // noite: com material pronto, fazer a cama entra junto do abrigo
  assert.deepEqual(ids(calmDay({ time: 'night', shelterNearby: true, baseHasBed: false, bedMaterials: true })),
    ['sleep_or_shelter', 'make_bed', 'continue_objective'])
})

test('descrição de return_base diz o que a base oferece (fato do runtime, sem mudar a escolha)', () => {
  const night = calmDay({ time: 'night', equippedWeapon: null, inventory: {}, baseHasBed: false })
  const back = candidateIntents(night).find((c) => c.id === 'return_base')
  assert.match(back.description, /no bed and no built shelter/)
  const withBed = candidateIntents({ ...night, baseHasBed: true }).find((c) => c.id === 'return_base')
  assert.match(withBed.description, /The base has a bed\./)
})

function inventoryBot(items) {
  return { inventory: { items: () => items.map(([name, count]) => ({ name, count })) } }
}

test('cama: lã equivalente conta 4 linhas por lã branca e exige 3 da mesma cor', () => {
  assert.equal(bed.woolEquivalent(inventoryBot([['white_wool', 1], ['string', 8]])), 3)
  assert.equal(bed.hasBedMaterials(inventoryBot([['white_wool', 1], ['string', 8]])), true)
  assert.equal(bed.woolEquivalent(inventoryBot([['white_wool', 1], ['black_wool', 2]])), 2)
  assert.equal(bed.hasBedMaterials(inventoryBot([['string', 11]])), false)
  assert.equal(bed.hasBedMaterials(inventoryBot([['red_bed', 1]])), true)
})

test('cama: pé e cabeceira livres sobre chão firme; a cabeceira segue a direção do bot até o pé', () => {
  const bot = {
    entity: { position: new Vec3(0.5, 64, 0.5) },
    blockAt: (p) => (p.y <= 63 ? { name: 'dirt', boundingBox: 'block' } : p.x === 2 && p.z === 0 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })
  }
  const spots = bed.bedSpots(bot)
  assert.ok(spots.length > 0)
  for (const { foot, head } of spots) {
    assert.equal(foot.distanceTo(head), 1)
    assert.ok(!(foot.x === 2 && foot.z === 0) && !(head.x === 2 && head.z === 0))
    const away = Math.abs(head.x) + Math.abs(head.z) > Math.abs(foot.x) + Math.abs(foot.z)
    assert.ok(away, `cabeceira ${head} deveria ficar depois do pé ${foot} visto do bot`)
  }
  assert.ok(!spots.some((s) => s.foot.x === 1 && s.foot.z === 0))       // cabeceira cairia na pedra
})

function bedWorker(choice) {
  const rows = []
  const auth = new JuliaAuthority({ endpoint: 'http://julia.test/choose', enabled: true, timeoutMs: 200,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choice }) }), eventLog: { log: (type, data) => rows.push({ type, data }) }, logger: { log() {} } })
  const worker = Object.create(WorkerController.prototype)
  Object.assign(worker, { name: 'bed-test', taskVersion: 1, homeProvider: () => new Vec3(0, 64, 0), logger: { log() {} }, _preparationDrain: null,
    juliaAuthority: auth, _baseBed: null, _failedHunts: new Set(), _sheltered: false })
  worker.bot = {
    health: 20, food: 20, time: { timeOfDay: 1000 }, entity: { position: new Vec3(20, 64, 0) }, entities: {},
    heldItem: { name: 'stone_sword' }, nearestEntity: () => null, inventory: { items: () => [{ name: 'stone_sword', count: 1 }], slots: [] },
    registry: { blocksArray: [{ name: 'white_bed', id: 99 }], blocksByName: {}, items: {} },
    findBlock: () => null, findBlocks: () => [], blockAt: (position) => ({ name: 'air', position }), pathfinder: { bestHarvestTool: () => null }
  }
  worker.production = { storage: { configured: () => false }, cachedCraftingTable: () => null }
  return { worker, rows }
}

function withFlags(fn) {
  const saved = [process.env.MBOT_EXPLORE_PREPARATION, process.env.MBOT_DETERMINISTIC_PREPARATION]
  process.env.MBOT_EXPLORE_PREPARATION = '1'
  process.env.MBOT_DETERMINISTIC_PREPARATION = '1'
  return Promise.resolve().then(fn).finally(() => {
    for (const [i, key] of ['MBOT_EXPLORE_PREPARATION', 'MBOT_DETERMINISTIC_PREPARATION'].entries()) {
      if (saved[i] === undefined) delete process.env[key]
      else process.env[key] = saved[i]
    }
  })
}

test('player loop: make_bed sem material caça a ovelha à vista; sem lã nova ela não é oferecida de novo', () => withFlags(async () => {
  const food = require('../lib/food')
  const original = food.hunt
  const { worker, rows } = bedWorker('make_bed')
  const sheep = { id: 7, name: 'sheep', type: 'passive', position: new Vec3(30, 64, 0) }
  worker.bot.nearestEntity = (match) => (match(sheep) ? sheep : null)
  let hunts = 0
  food.hunt = async () => { hunts++; return false }     // ovelha fugiu: nenhuma lã
  worker.explore = async () => ({ ok: true, x: 1, z: 1 })
  try {
    const result = await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
    assert.equal(hunts, 1)
    assert.equal(result.intent, 'make_bed')
    assert.equal(result.ok, false)
    assert.equal(rows.find((r) => r.type === 'julia_authority_cycle').data.action, 'bed:wool')
    const state = { time: 'day', nearby: {}, baseDistance: 20 }
    worker.bedFacts(state)
    assert.equal(state.nearby.sheep, false)            // a mesma ovelha não volta a ser oferecida
    assert.equal(state.baseHasBed, false)
  } finally { food.hunt = original }
}))

test('player loop: make_bed com material fabrica, volta à base, coloca e usa a cama', () => withFlags(async () => {
  const { worker } = bedWorker('make_bed')
  worker.bot.inventory.items = () => [{ name: 'stone_sword', count: 1 }, { name: 'white_bed', count: 1 }]
  worker.bot.nearestEntity = () => null
  const order = []
  worker.returnHome = async () => { order.push('home'); return { ok: true } }
  const originals = { placeBed: bed.placeBed, useBed: bed.useBed }
  bed.placeBed = async () => { order.push('place'); return { position: new Vec3(1, 64, 0) } }
  bed.useBed = async () => { order.push('use'); return 'ponto' }
  worker.explore = async () => ({ ok: true, x: 1, z: 1 })
  try {
    const result = await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.bed, 'placed:ponto')
    assert.deepEqual(order, ['home', 'place', 'use'])
    assert.ok(worker._baseBed)
  } finally { Object.assign(bed, originals) }
}))

test('noite: a cama da base a até 64 blocos conta como abrigo; o executor volta à base antes de dormir', () => withFlags(async () => {
  const night = require('../lib/night')
  const original = { spendNight: night.spendNight, findBed: night.findBed }
  const { worker } = bedWorker('sleep_or_shelter')
  worker._baseBed = new Vec3(1, 64, 0)
  worker.bot.time = { timeOfDay: 18000 }
  worker.bot.entity.position = new Vec3(50, 64, 0)
  worker.bot.blockAt = () => null                       // base fora dos chunks carregados: vale a lembrança
  const order = []
  night.findBed = () => null
  night.spendNight = async (_bot, _c, { onShelter }) => { order.push('night'); onShelter(true); assert.equal(worker._sheltered, true); onShelter(false); return 'dormi' }
  worker.returnHome = async () => { order.push('home'); return { ok: true } }
  worker.explore = async () => ({ ok: true, x: 1, z: 1 })
  try {
    const result = await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
    assert.deepEqual(order, ['home', 'night'], JSON.stringify(result))
    assert.equal(result.night, 'dormi')
  } finally { Object.assign(night, original) }
}))

test('vigia de progresso: trabalhando parado além do limite registra o contexto e libera o worker; abrigado não conta', () => {
  const logs = []
  const worker = Object.create(WorkerController.prototype)
  Object.assign(worker, { name: 'w', state: 'trabalhando', taskVersion: 3, currentTask: { type: 'explorar' }, _loopIntent: 'continue_objective',
    _sheltered: false, _progressAnchor: null, logger: { log: (m) => logs.push(m) } })
  worker.bot = { entity: { position: new Vec3(10, 64, 10) }, health: 20, food: 20, pathfinder: { goal: null, isMoving: () => false, setGoal() {} } }
  assert.equal(worker.progressTick(0), false)
  assert.equal(worker.progressTick(170000), false)
  worker._sheltered = true
  assert.equal(worker.progressTick(400000), false)            // dentro do abrigo: reinicia a contagem
  worker._sheltered = false
  assert.equal(worker.progressTick(400000), false)
  worker.bot.entity.position = new Vec3(11, 64, 10)            // 1 bloco: ainda parado
  assert.equal(worker.progressTick(590000), true)
  assert.equal(worker.taskVersion, 4)
  assert.equal(worker.state, 'ocioso')
  assert.match(logs[0], /sem progresso 3 min .*intenção=continue_objective/)
  worker.state = 'trabalhando'
  worker.bot.entity.position = new Vec3(20, 64, 10)
  assert.equal(worker.progressTick(600000), false)            // andou: âncora nova
})
