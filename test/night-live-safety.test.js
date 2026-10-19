const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const night = require('../lib/night')

function fixture() {
  const ground = new Vec3(0, 70, 0)
  const blocks = new Map()
  const digs = []
  let cancelled = false
  const bot = {
    entity: { position: new Vec3(4.5, 71, 0.5), onGround: true },
    inventory: { items: () => [{ name: 'dirt', count: 4 }] },
    blockAt: (p) => {
      const name = blocks.get(p.toString()) ?? (p.y <= 70 ? 'dirt' : 'air')
      return { name, position: p, boundingBox: ['air', 'water', 'lava'].includes(name) ? 'empty' : 'block' }
    },
    pathfinder: {
      goto: async () => { bot.entity.position = new Vec3(0.5, 71, 0.5) },
      setGoal: () => {}, bestHarvestTool: () => ({ name: 'wooden_pickaxe' })
    },
    equip: async () => {},
    dig: async (b) => { digs.push(b); blocks.set(b.position.toString(), 'air'); bot.entity.position.y = b.position.y },
    placeBlock: async () => {}
  }
  return { bot, ground, blocks, digs, cancel: () => { cancelled = true }, isCancelled: () => cancelled }
}

test('shelter refuses lava introduced while navigating to a previously safe site', async () => {
  const f = fixture()
  assert.equal(night.safeToDig(f.bot, f.ground), true)
  const navigate = f.bot.pathfinder.goto
  f.bot.pathfinder.goto = async () => {
    await navigate()
    f.blocks.set(new Vec3(1, 69, 0).toString(), 'lava')
  }
  await assert.rejects(night.digShelter(f.bot, f.ground, f.isCancelled), /escavação insegura/)
  assert.equal(f.digs.length, 0)
})

test('shelter rechecks escape materials after navigation', async () => {
  const f = fixture()
  f.bot.blockAt = (p) => ({ name: p.y <= 70 ? 'stone' : 'air', position: p, boundingBox: p.y <= 70 ? 'block' : 'empty' })
  const navigate = f.bot.pathfinder.goto
  f.bot.pathfinder.goto = async () => { await navigate(); f.bot.inventory.items = () => [] }
  await assert.rejects(night.digShelter(f.bot, f.ground, f.isCancelled), /escavação insegura/)
  assert.equal(f.digs.length, 0)
})

test('shelter rechecks the remaining column after equipping yields to world updates', async () => {
  const f = fixture()
  f.bot.equip = async () => { f.blocks.set(new Vec3(1, 69, 0).toString(), 'water') }
  await assert.rejects(night.digShelter(f.bot, f.ground, f.isCancelled), /escavação insegura/)
  assert.equal(f.digs.length, 0)
})

test('shelter cancellation during equip prevents a new dig', async () => {
  const f = fixture()
  f.bot.equip = async () => { f.cancel() }
  assert.equal(await night.digShelter(f.bot, f.ground, f.isCancelled), null)
  assert.equal(f.digs.length, 0)
})

test('shelter cancellation while equipping the lid prevents placement', async () => {
  const f = fixture()
  let placements = 0
  f.bot.equip = async (item) => { if (item.name === 'dirt') f.cancel() }
  f.bot.placeBlock = async () => { placements++ }
  assert.equal(await night.digShelter(f.bot, f.ground, f.isCancelled), null)
  assert.equal(f.digs.length, 3)
  assert.equal(placements, 0)
})
