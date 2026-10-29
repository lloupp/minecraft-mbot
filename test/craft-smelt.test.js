const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { smeltItem } = require('../lib/craft')

test('fornalha: sem combustível na mochila, usa o que já está na fornalha (sobra da fornada anterior)', async () => {
  const items = [{ name: 'beef', count: 2, type: 1 }]
  const put = []
  let outputs = 2
  const furnaceBlock = { position: new Vec3(1, 64, 0) }
  const bot = {
    registry: { itemsByName: { beef: { id: 1 } }, blocksByName: { furnace: { id: 9 } } },
    inventory: { items: () => items },
    findBlock: () => furnaceBlock,
    pathfinder: { goto: async () => {}, setGoal: () => {} },
    openFurnace: async () => ({
      fuelItem: () => ({ name: 'oak_log', count: 1 }),
      putFuel: async () => { put.push('fuel') },
      putInput: async (id, _m, count) => { put.push(['input', id, count]) },
      outputItem: () => (outputs > 0 ? { count: 1 } : null),
      takeOutput: async () => { outputs-- },
      close: () => {}
    })
  }
  const got = await smeltItem(bot, 'beef', 2, () => false)
  assert.equal(got, 2)
  assert.deepEqual(put, [['input', 1, 2]])
})

test('fornalha: sem combustível em lugar nenhum, falha dizendo isso', async () => {
  const bot = {
    registry: { itemsByName: { beef: { id: 1 } }, blocksByName: { furnace: { id: 9 } } },
    inventory: { items: () => [{ name: 'beef', count: 2, type: 1 }] },
    findBlock: () => ({ position: new Vec3(1, 64, 0) }),
    pathfinder: { goto: async () => {}, setGoal: () => {} },
    openFurnace: async () => ({ fuelItem: () => null, close: () => {} })
  }
  await assert.rejects(smeltItem(bot, 'beef', 2, () => false), /combustível/)
})

test('mesa inalcançável fica de lado e o bot usa outra ou coloca a própria', async () => {
  const { Vec3 } = require('vec3')
  const { ensureStation, markUnreachable } = require('../lib/craft')
  const far = new Vec3(10, 64, 0)
  const near = new Vec3(3, 64, 0)
  const bot = {
    registry: { blocksByName: { crafting_table: { id: 7 } }, itemsByName: { crafting_table: { id: 70 } } },
    findBlocks: () => [far, near],
    blockAt: (pos) => ({ name: 'crafting_table', position: pos })
  }
  assert.equal((await ensureStation(bot, 'crafting_table', () => false, 0)).position, far)
  markUnreachable(bot, { position: far })
  assert.equal((await ensureStation(bot, 'crafting_table', () => false, 0)).position, near)
})

test('túnel apertado: cava um espaço ao lado para colocar a mesa', async () => {
  const { Vec3 } = require('vec3')
  const { ensureStation } = require('../lib/craft')
  const world = new Map()
  const key = (p) => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`
  // Tudo pedra, exceto o túnel 1x2 onde o bot está (x=0, z de -3 a 3).
  const blockAt = (p) => {
    const name = world.get(key(p)) ?? ((p.x === 0 && (p.y === 10 || p.y === 11) && Math.abs(p.z) <= 3) ? 'air' : 'stone')
    return { name, position: new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), boundingBox: name === 'air' ? 'empty' : 'block' }
  }
  const items = [{ name: 'crafting_table', type: 70, count: 1 }]
  const bot = {
    entity: { position: new Vec3(0.5, 10, 0.5) },
    registry: { blocksByName: { crafting_table: { id: 7 } }, itemsByName: { crafting_table: { id: 70 } } },
    inventory: { items: () => items },
    findBlocks: () => [],
    findBlock: () => {
      for (const [k, name] of world) if (name === 'crafting_table') return blockAt(new Vec3(...k.split(',').map(Number)))
      return null
    },
    blockAt,
    canDigBlock: () => true,
    dig: async (b) => { world.set(key(b.position), 'air') },
    equip: async (item) => { bot.heldItem = item },
    heldItem: null,
    placeBlock: async (floor) => { world.set(key(floor.position.offset(0, 1, 0)), 'crafting_table') }
  }
  const table = await ensureStation(bot, 'crafting_table', () => false, 0)
  assert.equal(table?.name, 'crafting_table')
  // Abriu a parede ao lado (x=±1), não mexeu no chão sob os pés.
  assert.equal(blockAt(new Vec3(0, 9, 0)).name, 'stone')
})
