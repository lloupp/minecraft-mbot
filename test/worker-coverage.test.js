const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { WorkerController } = require('../core/WorkerController')

// Mundo mínimo: terra em y=63, ar acima. A enxada transforma terra em farmland
// e a semente vira trigo em cima do farmland.
function farmWorld({ items = [], extra = {} } = {}) {
  const blocks = new Map()
  const key = (p) => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`
  const blockAt = (p) => {
    const name = blocks.get(key(p)) ?? extra[key(p)] ?? (Math.floor(p.y) <= 63 ? 'dirt' : 'air')
    return { name, position: new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), boundingBox: ['air', 'water'].includes(name) ? 'empty' : 'block' }
  }
  const inventory = items.map((i) => ({ ...i }))
  let held = null
  const bot = {
    registry: { blocksByName: { water: { id: 9 } } },
    inventory: { items: () => inventory.filter((i) => i.count > 0) },
    blockAt,
    findBlock: () => null,
    equip: async (item) => { held = item },
    activateBlock: async (block) => { if (held?.name.endsWith('_hoe') && ['dirt', 'grass_block'].includes(block.name)) blocks.set(key(block.position), 'farmland') },
    placeBlock: async (reference, face) => {
      if (!held || held.count <= 0) throw new Error('mão vazia')
      blocks.set(key(reference.position.plus(face)), held.name === 'wheat_seeds' ? 'wheat' : held.name)
      held.count--
    },
    dig: async (block) => { blocks.set(key(block.position), 'air') }
  }
  return { bot, inventory, blockAt }
}

function worker(bot, extra = {}) {
  return Object.assign(Object.create(WorkerController.prototype), {
    bot, name: 'w1', logger: { log() {} }, homeProvider: () => ({ x: 0, y: 64, z: 0 }), storage: null, production: null,
    goTo: async () => {}
  }, extra)
}
const never = () => false

test('buildFarm ara e planta o 5x5 em volta da água do centro', async () => {
  const world = farmWorld({ items: [{ name: 'iron_hoe', count: 1 }, { name: 'wheat_seeds', count: 64 }], extra: { '10,63,10': 'water' } })
  const result = await worker(world.bot).buildFarm(never)
  assert.deepEqual(result, { ok: true, irrigated: true, tilled: 24, planted: 24, requestedPlots: 24, offset: { x: 8, z: 8 } })
  assert.equal(world.blockAt(new Vec3(8, 63, 8)).name, 'farmland')
  assert.equal(world.blockAt(new Vec3(8, 64, 8)).name, 'wheat')
  assert.equal(world.blockAt(new Vec3(10, 63, 10)).name, 'water')
})

test('buildFarm sem água nem sementes ainda ara, mas não declara sucesso', async () => {
  const world = farmWorld({ items: [{ name: 'stone_hoe', count: 1 }] })
  const result = await worker(world.bot).buildFarm(never, { x: 2, z: -3 })
  assert.equal(result.ok, false)
  assert.equal(result.irrigated, false)
  assert.equal(result.tilled, 24)
  assert.equal(result.planted, 0)
  assert.deepEqual(result.offset, { x: 2, z: -3 })
})

test('buildFarm cancelado para no meio', async () => {
  const world = farmWorld({ items: [{ name: 'iron_hoe', count: 1 }, { name: 'wheat_seeds', count: 64 }] })
  let calls = 0
  const result = await worker(world.bot).buildFarm(() => ++calls > 20)
  assert.ok(result.tilled < 24)
})

test('estoque e produção do worker exigem configuração e repassam o resultado', async () => {
  const bot = {}
  const bare = worker(bot)
  await assert.rejects(bare.withdrawFromStorage('bread', 2), /estoque central não configurado/)
  await assert.rejects(bare.depositCargo(), /estoque central não configurado/)
  await assert.rejects(bare.syncStorage(), /estoque central não configurado/)
  await assert.rejects(bare.craft('stick', 4), /produção não configurada/)
  const storage = {
    configured: () => true,
    withdraw: async (_b, item, count) => (item === 'bread' ? count : 0),
    depositCargo: async () => ({ oak_log: 5 }),
    summary: async () => ({ stone: 9 })
  }
  const production = { craftToStorage: async (_b, item, count) => ({ ok: true, item, count }) }
  const w = worker(bot, { storage, production })
  assert.deepEqual(await w.withdrawFromStorage('bread', 2), { ok: true, item: 'bread', withdrawn: 2, requested: 2 })
  assert.deepEqual(await w.withdrawFromStorage('cake', 1), { ok: false, item: 'cake', withdrawn: 0, requested: 1 })
  assert.deepEqual(await w.depositCargo(), { ok: true, deposited: { oak_log: 5 } })
  assert.deepEqual(await w.syncStorage(), { ok: true, stock: { stone: 9 } })
  assert.deepEqual(await w.craft('stick', 4), { ok: true, item: 'stick', count: 4 })
})

test('guard segue o dono, equipa a espada e ataca hostil a até 3 blocos', async () => {
  const attacked = []
  let goal = null
  const zombie = { type: 'hostile', position: new Vec3(2, 64, 0), height: 2 }
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    pathfinder: { setGoal: (g) => { goal = g } },
    nearestEntity: (filter) => (filter(zombie) ? zombie : null),
    inventory: { items: () => [{ name: 'stone_sword' }] },
    equip: async () => {},
    lookAt: async () => {},
    attack: (target) => attacked.push(target)
  }
  const w = worker(bot, { ensureRoleTool: async () => {}, ownerProvider: () => ({ position: new Vec3(5, 64, 5) }) })
  let ticks = 0
  assert.deepEqual(await w.guard(60000, () => ++ticks > 2), { ok: true })
  assert.ok(attacked.length >= 1)
  assert.ok(goal)
})

test('returnHome: sem base falha; com verify diz NOT_ARRIVED quando não chega', async () => {
  await assert.rejects(worker({ entity: { position: new Vec3(0, 64, 0) } }, { homeProvider: () => null }).returnHome(never), /base da colônia/)
  const far = worker({ entity: { position: new Vec3(100, 64, 100) } }, { goToWithDigging: async () => {} })
  assert.deepEqual(await far.returnHome(never, { verify: true }), { ok: false, code: 'NOT_ARRIVED' })
  const lost = worker({ entity: { position: new Vec3(100, 64, 100) } }, { goTo: async () => { throw new Error('No path to the goal!') }, goToWithDigging: async () => {} })
  assert.deepEqual(await lost.returnHome(never, { verify: true }), { ok: false, code: 'NOT_ARRIVED' })
  await assert.rejects(worker({ entity: { position: new Vec3(100, 64, 100) } }, { goTo: async () => { throw new Error('boom') } }).returnHome(never), /boom/)
})

test('returnHome na base confirma o marco na memória do mundo', async () => {
  const confirmed = []
  const w = worker({ entity: { position: new Vec3(0, 64, 1) } }, {
    worldMemory: { confirmLandmark: (name) => confirmed.push(name) },
    observeWorld: () => {}
  })
  assert.deepEqual(await w.returnHome(never, { verify: true }), { ok: true })
  assert.deepEqual(confirmed, ['base'])
})
