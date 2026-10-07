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
  assert.match(back.description, /no bed or shelter/)
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

test('vigia de progresso: ciclos curtos com ociosidade breve no mesmo lugar ainda contam; ocioso de verdade zera', () => {
  const worker = Object.create(WorkerController.prototype)
  Object.assign(worker, { name: 'w', state: 'trabalhando', taskVersion: 1, currentTask: { type: 'explorar' }, _loopIntent: 'find_food',
    _sheltered: false, _progressAnchor: null, logger: { log() {} } })
  worker.bot = { entity: { position: new Vec3(0, 64, 0) }, health: 20, food: 6, pathfinder: { goal: null, isMoving: () => false, setGoal() {} } }
  let t = 0
  worker.progressTick(t)
  for (; t < 170000; t += 10000) {
    worker.state = 'ocioso'; worker.progressTick(t + 2000)      // 2 s ocioso entre tarefas
    worker.state = 'trabalhando'; assert.equal(worker.progressTick(t + 5000), false)
  }
  worker.state = 'trabalhando'
  assert.equal(worker.progressTick(185000), true)
  worker.state = 'ocioso'; worker.progressTick(200000); worker.progressTick(240000)   // 40 s ocioso: zera
  worker.state = 'trabalhando'; worker.progressTick(241000)
  assert.equal(worker.progressTick(400000), false)
})

test('cama: lã a partir de linha é fabricada uma unidade por vez (várias repetições na grade 2x2 perdem linha)', async () => {
  const craft = require('../lib/craft')
  const original = craft.craftItem
  const items = [{ name: 'string', count: 12 }, { name: 'oak_planks', count: 3 }]
  const bot = { inventory: { items: () => items.filter((i) => i.count > 0) } }
  const calls = []
  craft.craftItem = async (_bot, name, count) => {
    calls.push([name, count])
    if (name === 'white_wool') {
      items.find((i) => i.name === 'string').count -= 4
      const w = items.find((i) => i.name === 'white_wool')
      if (w) w.count++; else items.push({ name: 'white_wool', count: 1 })
    }
    if (name === 'white_bed') items.push({ name: 'white_bed', count: 1 })
  }
  delete require.cache[require.resolve('../lib/bed')]
  const fresh = require('../lib/bed')
  try {
    const item = await fresh.craftBed(bot, () => false)
    assert.equal(item.name, 'white_bed')
    assert.deepEqual(calls, [['white_wool', 1], ['white_wool', 2], ['white_wool', 3], ['white_bed', 1]])
  } finally { craft.craftItem = original; delete require.cache[require.resolve('../lib/bed')] }
})

test('descrições cabem no contrato da Julia-1 (48 tokens por opção; ~230 caracteres como aproximação; medido com o tokenizador: máx. 44)', () => {
  const base = calmDay({ baseDistance: 123.4 })
  const states = [
    { ...base, time: 'night', equippedWeapon: null, inventory: {}, baseHasBed: false, shelterNearby: true, shelterKind: 'dig', bedMaterials: true },
    { ...base, time: 'night', equippedWeapon: null, inventory: {}, baseHasBed: true, shelterNearby: true, shelterKind: 'base_bed' },
    { ...base, time: 'night', shelterNearby: true, shelterKind: 'bed', baseHasBed: false, bedMaterials: true },
    { ...base, baseHasBed: false, bedMaterials: false, nearby: { sheep: true, sheepDistance: 140 } },
    { ...base, food: 6, edibleFood: 0, nearby: { food: true, foodDistance: 133.3 }, baseHasBed: false, baseHasFood: false }
  ]
  for (const state of states) {
    for (const c of candidateIntents(state)) assert.ok(c.description.length <= 230, `${c.id}: ${c.description.length} caracteres`)
  }
})

test('cama: ovelha certa = cor que fecha a cama; tosquiada não serve', () => {
  const sheep = (color, sheared = false) => ({ metadata: { 17: color | (sheared ? 0x10 : 0) } })
  assert.equal(bed.sheepWool(sheep(0)), 'white_wool')
  assert.equal(bed.sheepWool(sheep(7)), 'gray_wool')
  assert.equal(bed.sheepWool(sheep(0, true)), null)
  assert.equal(bed.sheepWool({ metadata: [] }), 'white_wool')   // campo padrão não enviado pelo servidor
  assert.equal(bed.sheepWool({}), 'unknown')
  assert.equal(bed.wantedWool(inventoryBot([])), null)
  assert.equal(bed.wantedWool(inventoryBot([['gray_wool', 2], ['white_wool', 1]])), 'gray_wool')
  assert.equal(bed.wantedWool(inventoryBot([['gray_wool', 1], ['string', 4]])), 'white_wool')   // empate: branca
  assert.equal(bed.wantedWool(inventoryBot([['gray_wool', 1], ['white_wool', 1], ['string', 8]])), 'white_wool')
})

test('return_base com fome diz que a base não guarda comida (fato do runtime; sem o campo, nada muda)', () => {
  const hungry = calmDay({ food: 6, edibleFood: 0, nearby: { food: true, foodDistance: 20 } })
  const desc = (extra) => candidateIntents({ ...hungry, ...extra }).find((c) => c.id === 'return_base').description
  assert.match(desc({ baseHasFood: false }), /The base has no food\./)
  assert.match(desc({ baseHasFood: false, baseHasBed: false }), /The base has no bed, shelter or food\./)
  assert.doesNotMatch(desc({ baseHasFood: null }), /food\./)
  assert.doesNotMatch(desc({}), /The base has no/)
})

test('afogando: o runtime informa drowning, o loop força escape_danger e o executor sai da água', () => withFlags(async () => {
  const { worker, rows } = bedWorker('continue_objective')
  worker.bot.oxygenLevel = 10
  worker.bot.entity.isInWater = true
  worker.bot.blockAt = (p) => {
    if (p.x >= 23 && p.y === 63) return { name: 'dirt', boundingBox: 'block', position: p }      // margem a 3 blocos
    if (p.y <= 64 && p.x < 23) return { name: 'water', boundingBox: 'empty', position: p }
    return { name: 'air', boundingBox: 'empty', position: p }
  }
  const jumps = []
  worker.bot.setControlState = (c, v) => jumps.push([c, v])
  worker.goTo = async (goal) => { worker.bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); worker.bot.entity.isInWater = false; worker.bot.oxygenLevel = 20 }
  worker.explore = async () => assert.fail('afogando não continua o objetivo')
  const result = await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
  assert.equal(result.escaped, 'water')
  assert.equal(result.ok, true)
  assert.equal(worker.bot.entity.position.x >= 23, true)
  assert.deepEqual(jumps, [['jump', true], ['jump', false]])
  const decision = rows.find((r) => r.type === 'julia_authority_decision').data
  assert.deepEqual(decision.candidates, ['escape_danger'])
  assert.equal(rows.find((r) => r.type === 'julia_authority_cycle').data.action, 'escape:water')
}))
