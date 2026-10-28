const test = require('node:test')
const assert = require('node:assert/strict')

const farm = require('../lib/farm')

function fakeBot({ items = [], blocks = {}, findBlocks = () => [], props = {} } = {}) {
  const inventory = items.slice()
  const stats = { equipped: [], activated: [], placed: [], dug: [], gotos: 0 }
  const pos = (x, y, z) => ({
    x, y, z,
    offset: (dx, dy, dz) => pos(x + dx, y + dy, z + dz),
    clone: () => pos(x, y, z),
    distanceTo: (o) => Math.hypot(o.x - x, o.y - y, o.z - z)
  })
  const bot = {
    inventory: { items: () => inventory },
    entity: { position: pos(0, 64, 0) },
    registry: {
      blocksByName: {
        dirt: { id: 3 }, grass_block: { id: 4 }, wheat: { id: 59 }, wheat_seeds: { id: 295 },
        short_grass: { id: 200 }, tall_grass: { id: 201 }, grass: { id: 202 }
      }
    },
    findBlocks: ({ matching }) => (typeof findBlocks === 'function' ? findBlocks(matching) : []),
    blockAt: (p) => {
      const key = `${p.x},${p.y},${p.z}`
      if (key in blocks) {
        const name = blocks[key]
        return {
          name,
          boundingBox: name === 'air' ? 'empty' : 'block',
          position: pos(p.x, p.y, p.z),
          offset: (dx, dy, dz) => p.offset(dx, dy, dz),
          clone: () => ({ ...pos(p.x, p.y, p.z), name, boundingBox: 'block' }),
          getProperties: () => ({ age: props[key] ?? 0 })
        }
      }
      return { name: 'air', boundingBox: 'empty', position: pos(p.x, p.y, p.z), offset: (dx, dy, dz) => p.offset(dx, dy, dz) }
    },
    pathfinder: { goto: async () => { stats.gotos++ }, setGoal: () => {} },
    equip: async (item) => stats.equipped.push(item.name),
    activateBlock: async (block) => { stats.activated.push(block.position || block) },
    placeBlock: async () => { stats.placed.push(1) },
    dig: async (block) => stats.dug.push(block.name),
    stats
  }
  return { bot, inventory, stats, pos }
}

const seed = (count) => ({ type: 295, name: 'wheat_seeds', count })
const hoe = (name = 'wooden_hoe') => ({ type: 300, name, count: 1 })

test('conta quanto trigo cada pão exige', () => {
  assert.equal(farm.wheatNeededFor(1), 3)
  assert.equal(farm.wheatNeededFor(8), 24)
  assert.equal(farm.wheatNeededFor(0), 3)
})

test('classifica o que pode ser arado', () => {
  assert.equal(farm.isTillable('dirt'), true)
  assert.equal(farm.isTillable('grass_block'), true)
  assert.equal(farm.isTillable('stone'), false)
  assert.equal(farm.isTillable('farmland'), false)
})

test('usa a enxada que já existe sem fabricar outra', async () => {
  const { bot } = fakeBot({ items: [hoe()] })
  let crafts = 0
  const found = await farm.ensureHoe(bot, { craftItem: async () => { crafts++ } })
  assert.equal(found.name, 'wooden_hoe')
  assert.equal(crafts, 0)
})

test('fabrica enxada de madeira quando não tem nenhuma', async () => {
  const { bot, inventory } = fakeBot()
  const crafted = []
  const found = await farm.ensureHoe(bot, { craftItem: async (_b, name) => { crafted.push(name); inventory.push(hoe(name)) } })
  assert.equal(found.name, 'wooden_hoe')
  assert.deepEqual(crafted, ['wooden_hoe'])
})

test('sem enxada e sem craft disponível devolve null', async () => {
  const { bot } = fakeBot()
  assert.equal(await farm.ensureHoe(bot), null)
})

test('junta sementes quebrando capim até a meta', async () => {
  const { bot, inventory } = fakeBot()
  const breakBlocks = async () => { inventory.push(seed(2)); return { broken: 4, found: 4 } }
  const result = await farm.collectSeeds(bot, 6, () => false, { breakBlocks })
  assert.equal(result.ok, true)
  assert.equal(result.seeds >= 6, true)
  assert.equal(result.blocks, 12)
})

test('para de quebrar capim quando não há mais alvo', async () => {
  const { bot } = fakeBot()
  const result = await farm.collectSeeds(bot, 6, () => false, { breakBlocks: async () => ({ broken: 0, found: 0 }) })
  assert.equal(result.ok, false)
  assert.equal(result.blocks, 0)
  assert.equal(result.rounds, 0)
})

test('quebra capim direto e recolhe as sementes derrubadas', async () => {
  const { bot, stats, pos } = fakeBot({
    blocks: { '3,64,0': 'short_grass', '4,64,0': 'tall_grass' },
    findBlocks: () => [pos(3, 64, 0), pos(4, 64, 0)]
  })
  const dropped = []
  const result = await farm.breakGrassForSeeds(bot, () => false, {
    drops: async (_bot, at) => { dropped.push([at.x, at.z]) }
  })
  assert.equal(result.broken, 2)
  assert.deepEqual(stats.dug, ['short_grass', 'tall_grass'])
  assert.deepEqual(dropped, [[3, 0], [4, 0]])
})

test('coleta usa o capim quebrado como fonte de sementes', async () => {
  const { bot, inventory } = fakeBot()
  let rounds = 0
  const result = await farm.collectSeeds(bot, 3, () => false, {
    breakBlocks: async () => { rounds++; inventory.push(seed(2)); return { broken: 3, found: 3 } },
    maxBlocks: 12
  })
  assert.equal(result.ok, true)
  assert.equal(rounds, 2)
})

test('sem capim por perto anda e tenta outra vez', async () => {
  const { bot, inventory } = fakeBot()
  const moves = []
  let calls = 0
  const breakBlocks = async () => {
    calls++
    if (calls < 3) return { broken: 0, found: 0 }
    inventory.push(seed(4))
    return { broken: 4, found: 4 }
  }
  const result = await farm.collectSeeds(bot, 4, () => false, {
    breakBlocks,
    move: async (round) => { moves.push(round) }
  })
  assert.equal(result.ok, true)
  assert.deepEqual(moves, [1, 2])
})

test('desiste depois das rodadas mesmo sem achar capim', async () => {
  const { bot } = fakeBot()
  const moves = []
  const result = await farm.collectSeeds(bot, 6, () => false, {
    breakBlocks: async () => ({ broken: 0, found: 0 }),
    rounds: 3,
    move: async (round) => { moves.push(round) }
  })
  assert.equal(result.ok, false)
  assert.deepEqual(moves, [1, 2, 3])
})

test('ara o canteiro e planta a semente', async () => {
  const { bot, stats, pos } = fakeBot({
    items: [seed(3), hoe()],
    blocks: { '2,63,0': 'grass_block', '2,64,0': 'air' },
    findBlocks: () => [pos(2, 63, 0)]
  })
  // depois de arar, o mesmo ponto passa a ser farmland
  const realBlockAt = bot.blockAt
  bot.blockAt = (p) => (p.y === 63 && p.x === 2 && p.z === 0 && stats.activated.length ? { name: 'farmland', boundingBox: 'block', position: pos(2, 63, 0), offset: (dx, dy, dz) => p.offset(dx, dy, dz) } : realBlockAt(p))
  const result = await farm.plantArea(bot, { center: pos(0, 64, 0), plots: 1, hoe: hoe() })
  assert.equal(result.ok, true)
  assert.equal(result.tilled, 1)
  assert.equal(result.planted, 1)
  assert.deepEqual(stats.equipped, ['wooden_hoe', 'wheat_seeds'])
  assert.equal(stats.placed.length, 1)
})

test('não planta em bloco sem espaço em cima', async () => {
  const { bot, pos } = fakeBot({
    items: [seed(3), hoe()],
    blocks: { '2,63,0': 'dirt', '2,64,0': 'stone' },
    findBlocks: () => [pos(2, 63, 0)]
  })
  const result = await farm.plantArea(bot, { center: pos(0, 64, 0), plots: 1, hoe: hoe() })
  assert.equal(result.planted, 0)
  assert.equal(result.ok, false)
})

test('colhe apenas trigo maduro', async () => {
  const { bot, stats, pos } = fakeBot({
    blocks: { '1,64,0': 'wheat', '2,64,0': 'wheat' },
    props: { '1,64,0': 7, '2,64,0': 3 },
    findBlocks: () => [pos(1, 64, 0), pos(2, 64, 0)]
  })
  const result = await farm.harvestRipe(bot, () => false, { radius: 8 })
  assert.equal(result.ripe, 1)
  assert.equal(result.harvested, 1)
  assert.deepEqual(stats.dug, ['wheat'])
})

test('colheita respeita cancelamento', async () => {
  const { bot, stats, pos } = fakeBot({
    blocks: { '1,64,0': 'wheat' },
    props: { '1,64,0': 7 },
    findBlocks: () => [pos(1, 64, 0)]
  })
  const result = await farm.harvestRipe(bot, () => true, { radius: 8 })
  assert.equal(result.harvested, 0)
  assert.deepEqual(stats.dug, [])
})

test('conta os pés de trigo já plantados', () => {
  const { bot, pos } = fakeBot({
    blocks: { '1,64,0': 'wheat', '2,64,0': 'wheat' },
    findBlocks: () => [pos(1, 64, 0), pos(2, 64, 0)]
  })
  assert.equal(farm.countCrops(bot, { radius: 8 }), 2)
})

test('sem trigo plantado a contagem é zero', () => {
  const { bot } = fakeBot({ findBlocks: () => [] })
  assert.equal(farm.countCrops(bot), 0)
})

test('espera trigo maduro e para quando aparece', async () => {
  const { bot, pos } = fakeBot({
    blocks: { '1,64,0': 'wheat' },
    props: { '1,64,0': 7 },
    findBlocks: () => [pos(1, 64, 0)]
  })
  const result = await farm.waitRipe(bot, { minutes: 1, sleepMs: 10 })
  assert.equal(result.ok, true)
  assert.equal(result.ripe, 1)
})

test('espera desiste no prazo quando nada amadurece', async () => {
  const { bot, pos } = fakeBot({
    blocks: { '1,64,0': 'wheat' },
    props: { '1,64,0': 1 },
    findBlocks: () => [pos(1, 64, 0)]
  })
  const result = await farm.waitRipe(bot, { minutes: 0, sleepMs: 1 })
  assert.equal(result.ok, false)
})
