const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')

const handover = require('../lib/handover')

const CHEST = handover.DELIVERY_CHEST

function fakeBot({ items = [], existingChest = CHEST, ground = 'stone' } = {}) {
  const inventory = items.slice()
  const world = new Map()
  const stats = { placed: [] }
  const key = (x, y, z) => `${x},${y},${z}`
  const groundY = CHEST.y - 1
  if (existingChest) world.set(key(existingChest.x, existingChest.y, existingChest.z), 'chest')
  const blockAt = (pos) => {
    const name = world.get(key(pos.x, pos.y, pos.z)) || (pos.y === groundY ? ground : 'air')
    return { name, boundingBox: name === 'air' ? 'empty' : 'block', position: new Vec3(pos.x, pos.y, pos.z) }
  }
  const bot = {
    inventory: { items: () => inventory },
    entity: { position: { x: CHEST.x, y: CHEST.y, z: CHEST.z } },
    stats,
    blockAt,
    equip: async (item) => { stats.equipped = item.name },
    placeBlock: async (floor, offset) => {
      const x = floor.position.x + offset.x
      const y = floor.position.y + offset.y
      const z = floor.position.z + offset.z
      world.set(key(x, y, z), 'chest')
      stats.placed.push({ x, y, z })
    }
  }
  return { bot, inventory, stats }
}

test('cria baú novo longe do contêiner existente', async () => {
  const { bot, stats } = fakeBot({ items: [{ type: 900, name: 'chest', count: 1 }] })
  const made = await handover.createChestAt(bot, CHEST)
  assert.equal(made.created, true)
  assert.equal(stats.placed.length, 1)
  const placed = stats.placed[0]
  const distance = Math.max(Math.abs(placed.x - CHEST.x), Math.abs(placed.z - CHEST.z))
  assert.ok(distance > 2, `baú novo deve ficar longe do antigo (ficou a ${distance})`)
})

test('recusa criar baú sem item e sem material', async () => {
  const { bot } = fakeBot({ items: [] })
  const made = await handover.createChestAt(bot, CHEST, { withdraw: async () => 0 })
  assert.equal(made.created, false)
  assert.match(made.reason, /não tenho baú/)
})

test('fabrica baú novo com tábuas do estoque', async () => {
  const { bot, inventory } = fakeBot({ items: [] })
  const made = await handover.createChestAt(bot, CHEST, {
    withdraw: async () => { inventory.push({ type: 5, name: 'oak_planks', count: 8 }); return 8 },
    craftItem: async (_bot, name) => { inventory.push({ type: 900, name, count: 1 }) }
  })
  assert.equal(made.created, true)
})
