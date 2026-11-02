const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { WorkerController } = require('../core/WorkerController')

// Mundo de blocos mínimo: chão de pedra em y=63, ar acima, e um inventário
// que gasta o item na mão ao colocar.
function fakeWorld({ items = [], ground = 63, extra = {} } = {}) {
  const blocks = new Map()
  const key = (p) => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`
  const blockAt = (p) => {
    const name = blocks.get(key(p)) ?? extra[key(p)] ?? (Math.floor(p.y) <= ground ? 'stone' : 'air')
    return { name, position: new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), boundingBox: name === 'air' || name === 'water' ? 'empty' : 'block' }
  }
  const inventory = items.map((item) => ({ ...item }))
  let held = null
  const bot = {
    version: '1.20.1',
    registry: { blocksByName: { stone: { id: 1 }, water: { id: 9 } } },
    inventory: { items: () => inventory.filter((item) => item.count > 0) },
    blockAt,
    equip: async (item) => { held = item },
    placeBlock: async (reference, face) => {
      if (!held || held.count <= 0) throw new Error('mão vazia')
      blocks.set(key(reference.position.plus(face)), held.name)
      held.count--
    },
    dig: async (block) => { blocks.set(key(block.position), 'air') },
    findBlock: ({ matching }) => (matching.includes?.(1) || matching === 1 ? blockAt(new Vec3(10, 63, 0)) : null),
    pathfinder: { bestHarvestTool: () => null }
  }
  return { bot, blocks, set: (p, name) => blocks.set(key(p), name), inventory }
}

function worker(world, extra = {}) {
  const w = Object.create(WorkerController.prototype)
  Object.assign(w, {
    bot: world.bot,
    name: 'construtor1',
    logger: { log() {} },
    homeProvider: () => ({ x: 0, y: 64, z: 0 }),
    storage: null,
    production: null,
    goTo: async () => {},
    collectDrops: async () => {},
    ensureRoleTool: async () => {}
  }, extra)
  return w
}

const never = () => false

test('buildingMaterial escolhe a maior pilha permitida com o mínimo pedido', () => {
  const w = worker(fakeWorld({ items: [{ name: 'dirt', count: 30 }, { name: 'cobblestone', count: 40 }, { name: 'diamond', count: 64 }] }))
  assert.equal(w.buildingMaterial(23).name, 'cobblestone')
  assert.equal(w.buildingMaterial(50), null)
  assert.deepEqual(w.buildingMaterials().map((i) => i.name), ['cobblestone', 'dirt'])
})

test('placeAt: ocupado conta como feito, sem apoio falha, com chão coloca', async () => {
  const world = fakeWorld({ items: [{ name: 'cobblestone', count: 5 }] })
  const w = worker(world)
  const item = world.inventory[0]
  assert.equal(await w.placeAt(new Vec3(0, 63, 0), item, never), true)
  assert.equal(world.inventory[0].count, 5)
  assert.equal(await w.placeAt(new Vec3(0, 80, 0), item, never), false)
  assert.equal(await w.placeAt(new Vec3(0, 64, 0), item, never), true)
  assert.equal(world.bot.blockAt(new Vec3(0, 64, 0)).name, 'cobblestone')
  assert.equal(await w.placeAt(new Vec3(1, 64, 0), item, () => true), false)
})

test('buildHouse: exige base e 23 blocos; com material ergue o abrigo 3x3 inteiro', async () => {
  await assert.rejects(worker(fakeWorld(), { homeProvider: () => null }).buildHouse(never), /base da colônia/)
  await assert.rejects(worker(fakeWorld({ items: [{ name: 'dirt', count: 5 }] })).buildHouse(never), /preciso de 23 blocos de construção; tenho 5/)
  const world = fakeWorld({ items: [{ name: 'cobblestone', count: 30 }] })
  const result = await worker(world).buildHouse(never)
  assert.deepEqual(result, { ok: true, placed: 23, requested: 23, materials: { cobblestone: 23 }, offset: { x: 5, z: 2 } })
  // Porta aberta na frente (z=0, x=1) nas duas alturas.
  assert.equal(world.bot.blockAt(new Vec3(6, 64, 2)).name, 'air')
  assert.equal(world.bot.blockAt(new Vec3(6, 65, 2)).name, 'air')
  assert.equal(world.bot.blockAt(new Vec3(6, 66, 3)).name, 'cobblestone')
})

test('buildHouse busca no estoque o que falta antes de desistir', async () => {
  const world = fakeWorld({ items: [{ name: 'cobblestone', count: 10 }] })
  const storage = {
    configured: () => true,
    withdrawBuildingMaterial: async (_bot, count) => { world.inventory[0].count += count }
  }
  const result = await worker(world, { storage }).buildHouse(never)
  assert.equal(result.placed, 23)
})

test('buildMine abre o túnel a partir da rocha e conta os trechos limpos', async () => {
  const world = fakeWorld({ ground: 70 })
  const result = await worker(world).buildMine(never, 6)
  assert.equal(result.ok, true)
  assert.equal(result.length, 6)
  assert.equal(result.clearedSegments, 6)
  assert.equal(result.dug, 12)
  assert.deepEqual(result.start, { x: 10, y: 63, z: 0 })
  assert.equal(world.bot.blockAt(new Vec3(15, 64, 0)).name, 'air')
})

test('buildMine para antes de cavar embaixo de cascalho', async () => {
  const world = fakeWorld({ ground: 70, extra: { '12,65,0': 'gravel' } })
  const result = await worker(world).buildMine(never, 6)
  assert.equal(result.blockedBy, 'areia_cascalho')
  assert.equal(result.clearedSegments, 2)
})

test('buildMine sem base ou sem rocha por perto falha com motivo', async () => {
  await assert.rejects(worker(fakeWorld(), { homeProvider: () => null }).buildMine(never), /base da colônia/)
  const world = fakeWorld()
  world.bot.findBlock = () => null
  await assert.rejects(worker(world).buildMine(never), /não encontrei rocha/)
})

test('ensureHoe: inventário, depois estoque, depois fabricação da melhor possível', async () => {
  const has = fakeWorld({ items: [{ name: 'stone_hoe', count: 1 }] })
  assert.equal((await worker(has).ensureHoe()).name, 'stone_hoe')

  const crafted = fakeWorld()
  const tried = []
  const production = {
    craftInternal: async (_bot, name) => {
      tried.push(name)
      if (name === 'iron_hoe') throw new Error('sem ferro')
      crafted.inventory.push({ name, count: 1 })
    }
  }
  assert.equal((await worker(crafted, { production }).ensureHoe()).name, 'stone_hoe')
  assert.deepEqual(tried, ['iron_hoe', 'stone_hoe'])
  assert.equal(await worker(fakeWorld()).ensureHoe(), null)
})

test('buildFarm exige base e enxada', async () => {
  await assert.rejects(worker(fakeWorld(), { homeProvider: () => null }).buildFarm(never), /base da colônia/)
  await assert.rejects(worker(fakeWorld()).buildFarm(never), /enxada/)
})

test('farmSeedStack pega sementes do estoque quando não tem', async () => {
  const world = fakeWorld()
  const storage = {
    configured: () => true,
    withdraw: async (_bot, name, count) => {
      if (name !== 'carrot') return 0
      world.inventory.push({ name, count })
      return count
    }
  }
  assert.equal((await worker(world, { storage }).farmSeedStack()).name, 'carrot')
  assert.equal(await worker(fakeWorld()).farmSeedStack(), null)
})

test('ensureWaterAt: água no lugar conta; sem balde não inventa', async () => {
  const world = fakeWorld({ extra: { '2,63,2': 'water' } })
  assert.equal(await worker(world).ensureWaterAt(new Vec3(2, 63, 2), never), true)
  const dry = fakeWorld()
  dry.bot.findBlock = () => null
  assert.equal(await worker(dry).ensureWaterAt(new Vec3(2, 63, 2), never), false)
})

test('blockMatches compara o bloco do mundo com o passo da planta', () => {
  const world = fakeWorld()
  world.set(new Vec3(1, 64, 1), 'oak_planks')
  const w = worker(world)
  assert.equal(w.blockMatches({ x: 0, y: 64, z: 0 }, { x: 1, y: 0, z: 1, name: 'oak_planks' }), true)
  assert.equal(w.blockMatches({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 0, name: 'oak_planks' }), false)
})
