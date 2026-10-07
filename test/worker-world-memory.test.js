const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { WorkerController } = require('../core/WorkerController')
const gather = require('../lib/gather')
const { WorldMemory, STATUS } = require('../lib/world-memory')

const NAMES = ['air', 'oak_log', 'stone', 'crafting_table']
const registry = { blocksArray: NAMES.map((name, id) => ({ name, id })), blocksByName: Object.fromEntries(NAMES.map((name, id) => [name, { id, name }])) }

function setup({ guide = true, memory = new WorldMemory() } = {}) {
  const world = new Map()
  const worker = Object.create(WorkerController.prototype)
  worker.name = 'w1'; worker.role = 'lenhador'; worker.taskVersion = 1; worker.exploreStep = 0
  worker.logger = { log() {} }
  worker.homeProvider = () => new Vec3(0, 64, 0)
  worker.worldMemory = memory
  worker.storage = null
  worker.ensureRoleTool = async () => null
  worker.goCalls = []
  worker.goFail = false
  worker.bot = {
    registry, game: { dimension: 'minecraft:overworld' }, entity: { position: new Vec3(0, 64, 0) },
    blockAt: (p) => ({ name: world.get(`${p.x},${p.y},${p.z}`) || 'air', position: p }),
    findBlocks: ({ matching, maxDistance, count, point }) => {
      const ids = new Set([].concat(matching)); const o = point || worker.bot.entity.position; const out = []
      for (const [k, n] of world) { const [x, y, z] = k.split(',').map(Number); const p = new Vec3(x, y, z); if (ids.has(registry.blocksByName[n].id) && p.distanceTo(o) <= maxDistance) out.push(p) }
      return out.sort((a, b) => a.distanceTo(o) - b.distanceTo(o)).slice(0, count)
    }
  }
  worker.goTo = async (goal) => {
    worker.goCalls.push({ x: goal.x, y: goal.y, z: goal.z })
    if (worker.goFail) throw new Error('caminho demorou demais')
    worker.bot.entity.position = new Vec3(goal.x, goal.y, goal.z)
  }
  if (guide) process.env.MBOT_WORLD_MEMORY_GUIDE = '1'; else delete process.env.MBOT_WORLD_MEMORY_GUIDE
  return { worker, world, memory }
}
test.afterEach(() => { delete process.env.MBOT_WORLD_MEMORY_GUIDE })

const never = () => false

test('explore: sem flag segue o anel clássico mesmo com memória; ainda mede repetições', async () => {
  const { worker, memory } = setup({ guide: false })
  memory.visit('overworld', { x: 16, z: 0 }); memory.visit('overworld', { x: 0, z: 0 })
  await worker.explore(64, never)
  assert.deepEqual([worker.goCalls[0].x, worker.goCalls[0].z], [16, 0]) // clássico: direção 0, anel 1
  assert.equal(memory.metrics.exploreChoices, 1)
  assert.equal(memory.metrics.exploreRepeats, 1) // baseline: o clássico repetiu região já visitada
})

test('explore: memória vazia com flag mantém o clássico', async () => {
  const { worker } = setup()
  await worker.explore(64, never)
  assert.deepEqual([worker.goCalls[0].x, worker.goCalls[0].z], [16, 0])
})

test('explore: com flag e memória evita o chunk visitado e registra cobertura', async () => {
  const { worker, memory } = setup()
  memory.visit('overworld', { x: 16, z: 0 }); memory.visit('overworld', { x: 0, z: 0 })
  await worker.explore(64, never)
  const first = worker.goCalls[0]
  assert.notDeepEqual([first.x, first.z], [16, 0])
  assert.equal(memory.metrics.exploreRepeats, 0)
  assert.equal(memory.exploredRecently('overworld', { x: first.x, z: first.z }), true) // visitado ao chegar
})

test('explore: GoalNear para antes do alvo (chunk vizinho) mas o chunk do alvo conta como visitado — sem repetir o mesmo destino', async () => {
  const { worker, memory } = setup()
  worker.goTo = async (goal) => { // realista: o pathfinder encerra a até 3 blocos do alvo
    worker.goCalls.push({ x: goal.x, y: goal.y, z: goal.z })
    worker.bot.entity.position = new Vec3(goal.x - 3, goal.y, goal.z)
  }
  memory.visit('overworld', { x: 0, z: 0 })
  const targets = []
  for (let i = 0; i < 6; i++) { await worker.explore(64, never); targets.push(`${worker.goCalls.at(-1).x},${worker.goCalls.at(-1).z}`) }
  assert.equal(new Set(targets).size, 6, targets.join(' '))
})

test('explore: caminho que falha vira route_failed (evidência) e não invalida nada', async () => {
  const { worker, memory } = setup()
  worker.goFail = true
  await assert.rejects(() => worker.explore(64, never), /demorou/)
  const hazard = [...memory.places.values()].find((p) => p.kind === 'route_failed')
  assert.ok(hazard)
  assert.equal(hazard.failures, 1)
})

test('segundo explorador (ou reinício, exploreStep zerado) não repete o que o primeiro já cobriu', async () => {
  const run = async (guide) => {
    const { worker: a, memory } = setup({ guide })
    for (let i = 0; i < 12; i++) await a.explore(96, never)
    const { worker: b } = setup({ guide, memory }) // contador próprio, mesma memória compartilhada
    const before = memory.metrics.exploreRepeats
    for (let i = 0; i < 12; i++) await b.explore(96, never)
    return { repeats: memory.metrics.exploreRepeats - before, distinct: new Set(b.goCalls.map((c) => `${c.x},${c.z}`)).size }
  }
  const off = await run(false)
  const on = await run(true)
  assert.ok(off.repeats >= 6, JSON.stringify({ on, off })) // clássico recomeça do anel 1
  assert.equal(on.repeats, 0, JSON.stringify({ on, off }))
  assert.ok(on.distinct >= off.distinct)
})

function stubMine(results) {
  const original = gather.mineBlocks
  const calls = []
  gather.mineBlocks = async (_bot, _pred, count, _c, { onAttempt }) => {
    const r = results.shift()
    calls.push(count)
    if (r.code) onAttempt({ code: r.code })
    for (let i = 0; i < r.mined; i++) onAttempt({ itemConfirmed: true, targetPosition: { x: 101, y: 70, z: 1 } })
    return r.mined
  }
  return { calls, restore: () => { gather.mineBlocks = original } }
}

test('gather: sem recurso à vista usa a lembrança, CONFIRMA no mundo e só então coleta', async () => {
  const { worker, world, memory } = setup()
  world.set('100,70,0', 'oak_log'); world.set('100,71,0', 'oak_log')
  memory.discover('wood', 'overworld', { x: 100, y: 70, z: 0 }, { count: 2, by: 'outro_worker' })
  const mine = stubMine([{ mined: 0, code: 'RESOURCE_NOT_FOUND' }, { mined: 2 }])
  try {
    const result = await worker.gatherBlocks('madeira', 2, never)
    assert.equal(result.ok, true)
    assert.equal(result.gathered, 2)
    assert.deepEqual(mine.calls, [2, 2])
    assert.equal(worker.goCalls.length, 1)
    assert.equal(memory.metrics.usefulQueries, 1)
    assert.equal(memory.metrics.staleQueries, 0)
  } finally { mine.restore() }
})

test('gather: árvore removida => invalida, não coleta lá e não entra em loop', async () => {
  const { worker, memory } = setup()
  memory.discover('wood', 'overworld', { x: 100, y: 70, z: 0 }, { count: 2 }) // mundo real: ar
  const mine = stubMine([{ mined: 0, code: 'RESOURCE_NOT_FOUND' }])
  try {
    const result = await worker.gatherBlocks('madeira', 2, never)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'RESOURCE_NOT_FOUND')
    assert.deepEqual(mine.calls, [2]) // sem segunda tentativa física
    assert.equal(memory.metrics.invalidated, 1)
    assert.equal(memory.metrics.staleQueries, 1)
  } finally { mine.restore() }
  const again = stubMine([{ mined: 0, code: 'RESOURCE_NOT_FOUND' }])
  try {
    worker.goCalls.length = 0
    await worker.gatherBlocks('madeira', 2, never)
    assert.equal(worker.goCalls.length, 0) // nada para sugerir: não volta ao local invalidado
  } finally { again.restore() }
})

test('gather: caminho impossível adia a hipótese (cooldown) sem apagá-la', async () => {
  const { worker, memory } = setup()
  worker.goFail = true
  const p = memory.discover('wood', 'overworld', { x: 100, y: 70, z: 0 })
  const mine = stubMine([{ mined: 0, code: 'RESOURCE_NOT_FOUND' }])
  try { await worker.gatherBlocks('madeira', 1, never) } finally { mine.restore() }
  assert.notEqual(p.status, STATUS.INVALIDATED)
  assert.ok(p.skipUntil > Date.now() - 1000)
})

test('gather: sem a flag a memória só observa, nunca desvia', async () => {
  const { worker, memory } = setup({ guide: false })
  memory.discover('wood', 'overworld', { x: 100, y: 70, z: 0 })
  const mine = stubMine([{ mined: 0, code: 'RESOURCE_NOT_FOUND' }])
  try { await worker.gatherBlocks('madeira', 1, never) } finally { mine.restore() }
  assert.deepEqual(mine.calls, [1])
  assert.equal(worker.goCalls.length, 0)
})

test('gather confirmado registra a fonte na memória', async () => {
  const { worker, memory } = setup()
  const mine = stubMine([{ mined: 1 }])
  try { await worker.gatherBlocks('madeira', 1, never) } finally { mine.restore() }
  assert.ok(memory.find('wood', 'overworld', { x: 101, y: 70, z: 1 }))
})

test('preparação: sítio lembrado só é aceito se a mesa existir de verdade ao chegar', async () => {
  const { worker, world, memory } = setup()
  memory.discover('crafting_table', 'overworld', { x: 60, y: 64, z: 0 })
  memory.discover('wood', 'overworld', { x: 62, y: 64, z: 3 })
  memory.discover('stone', 'overworld', { x: 58, y: 64, z: -3 })
  worker.production = { rememberCraftingTable: (_b, block) => { worker.remembered = block } }
  // mesa sumiu
  assert.equal(await worker.tryRememberedPreparationSite(never), false)
  assert.equal(memory.find('crafting_table', 'overworld', { x: 60, y: 64, z: 0 }).status, STATUS.INVALIDATED)
  // mesa recolocada e memória reobservada
  world.set('60,64,0', 'crafting_table'); world.set('62,64,3', 'oak_log'); world.set('58,64,-3', 'stone')
  for (const [kind, x, z] of [['crafting_table', 60, 0], ['wood', 62, 3], ['stone', 58, -3]]) memory.discover(kind, 'overworld', { x, y: 64, z })
  worker.bot.entity.position = new Vec3(0, 64, 0)
  assert.equal(await worker.tryRememberedPreparationSite(never), true)
  assert.equal(worker.remembered.name, 'crafting_table')
})

test('preparação: sítio lembrado consulta o mundo com Vec3 (blockAt do mineflayer chama floored())', async () => {
  const { worker, world, memory } = setup()
  world.set('60,64,0', 'crafting_table'); world.set('62,64,3', 'oak_log'); world.set('58,64,-3', 'stone')
  for (const [kind, x, z] of [['crafting_table', 60, 0], ['wood', 62, 3], ['stone', 58, -3]]) memory.discover(kind, 'overworld', { x, y: 64, z })
  worker.production = { rememberCraftingTable: (_b, block) => { worker.remembered = block } }
  const original = worker.bot.blockAt
  worker.bot.blockAt = (p) => { p.floored(); return original(p) }   // como o mineflayer: ponto simples quebra aqui
  worker.bot.entity.position = new Vec3(0, 64, 0)
  assert.equal(await worker.tryRememberedPreparationSite(never), true)
  assert.equal(worker.remembered.name, 'crafting_table')
})

test('comida: animais vistos viram lembrança "food"; com fome e nada caçável a 48, o rebanho lembrado vira comida alcançável', async () => {
  const { worker, memory } = setup()
  const worldObserver = require('../lib/world-observer')
  worker.bot.entities = { 1: { name: 'cow', position: new Vec3(90, 64, 5) }, 2: { name: 'cow', position: new Vec3(91, 64, 6) }, 3: { name: 'zombie', position: new Vec3(5, 64, 5) } }
  worldObserver.observeSurroundings(worker.bot, memory, { by: 'w1' })
  const [pick] = memory.suggest('food', 'overworld', new Vec3(0, 64, 0), { limit: 1 })
  assert.ok(pick && Math.abs(pick.place.x - 90) <= 1)
  const state = (food, nearbyFood = false, inventory = {}) => ({ food, inventory, nearby: { food: nearbyFood } })
  assert.equal(worker.rememberedFoodHint(state(15)), null)                  // sem fome: não usa a lembrança
  assert.equal(worker.rememberedFoodHint(state(6, true)), null)             // já há comida caçável perto
  const hungry = state(6)
  assert.ok(worker.rememberedFoodHint(hungry))
  assert.equal(hungry.nearby.food, true)

  // Ida ao rebanho: chegou e não há animal nenhum -> lembrança invalidada.
  worker.bot.entities = {}
  const got = await worker.huntRememberedFood(hungry.nearby.foodRemembered, async () => null, never)
  assert.equal(got, null)
  assert.equal(memory.find('food', 'overworld', new Vec3(pick.place.x, pick.place.y, pick.place.z)).status, STATUS.INVALIDATED)
})

test('comida lembrada: chegando lá só com os últimos animais (poupados pelo executor), a lembrança é invalidada', async () => {
  const { worker, memory } = setup()
  const worldObserver = require('../lib/world-observer')
  const pair = { 1: { id: 1, name: 'chicken', position: new Vec3(90, 64, 5) }, 2: { id: 2, name: 'chicken', position: new Vec3(91, 64, 6) } }
  worker.bot.entities = pair
  worldObserver.observeSurroundings(worker.bot, memory, { by: 'w1' })
  const hungry = { food: 6, inventory: {}, nearby: { food: false } }
  assert.ok(worker.rememberedFoodHint(hungry))
  worker.bot.food = 6
  worker.bot.entity.position = new Vec3(88, 64, 4)
  worker.bot.nearestEntity = (match) => Object.values(worker.bot.entities).find(match) || null
  worker.goTo = async () => {}
  await worker.huntRememberedFood(hungry.nearby.foodRemembered, async () => null, never)
  const place = hungry.nearby.foodRemembered
  assert.equal(memory.find('food', 'overworld', new Vec3(place.x, place.y, place.z)).status, STATUS.INVALIDATED)
})
