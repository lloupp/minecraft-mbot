const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { createReplacementChest } = require('../lib/storage-recovery')

function fixture() {
  const placed = new Map()
  const items = [{ name: 'chest', count: 1 }]
  const attempts = []
  const bot = {
    entity: { position: new Vec3(0, 64, 2) }, health: 20,
    inventory: { items: () => items }, registry: {},
    blockAt: p => placed.get(p.toString()) || { name: p.y === 63 ? 'dirt' : 'air', boundingBox: p.y === 63 ? 'block' : 'empty', position: p },
    pathfinder: { goto: async () => {}, setGoal() {} },
    equip: async () => {}, lookAt: async () => {},
    placeBlock: async reference => {
      const position = reference.position.offset(0, 1, 0)
      attempts.push(position.toString())
      placed.set(position.toString(), { name: 'chest', position })
    }
  }
  return { bot, attempts, items, placed }
}
const origin = { x: 0, y: 64, z: 0 }

test('replacement tries another local site after a server placement rejection', async () => {
  const { bot, attempts, placed } = fixture()
  bot.placeBlock = async reference => {
    const position = reference.position.offset(0, 1, 0)
    attempts.push(position.toString())
    if (attempts.length === 1) throw new Error('Server refused to place chest')
    placed.set(position.toString(), { name: 'chest', position })
  }
  const chest = await createReplacementChest(bot, origin)
  assert.equal(chest.name, 'chest')
  assert.equal(attempts.length, 2)
  assert.notEqual(attempts[0], attempts[1])
})

test('unconfirmed placement is never success and stops after three sites', async () => {
  const { bot, attempts } = fixture()
  bot.placeBlock = async reference => { attempts.push(reference.position.toString()) }
  await assert.rejects(createReplacementChest(bot, origin), /não confirmado/)
  assert.equal(attempts.length, 3)
  assert.equal(new Set(attempts).size, 3)
})

test('cancellation after rejected placement prevents another physical action', async () => {
  const { bot, attempts } = fixture()
  let cancelled = false
  bot.placeBlock = async () => { attempts.push('once'); cancelled = true; throw new Error('rejected') }
  await assert.rejects(createReplacementChest(bot, origin, () => cancelled), /cancelada/)
  assert.equal(attempts.length, 1)
})

test('missing local crafting ingredients never trigger remote collection', async () => {
  const { bot, items, attempts } = fixture()
  items.length = 0
  bot.craft = async () => assert.fail('cannot craft or gather unavailable ingredients')
  await assert.rejects(createReplacementChest(bot, origin), /ingredientes prontos/)
  assert.equal(attempts.length, 0)
})

test('replacement can craft a ready local recipe at an observed nearby table', async () => {
  const { bot, items } = fixture()
  items.length = 0
  const recipe = { result: { id: 5, count: 1 } }
  const table = { name: 'crafting_table', position: new Vec3(1, 64, 2) }
  bot.registry = { itemsByName: { chest: { id: 5 } }, blocksByName: { crafting_table: { id: 6 } } }
  bot.findBlock = opts => { assert.equal(opts.maxDistance, 4); return table }
  bot.recipesFor = (id, metadata, count, observed) => { assert.equal(id, 5); assert.equal(observed, table); return [recipe] }
  bot.craft = async (actual, count, observed) => { assert.equal(actual, recipe); assert.equal(count, 1); assert.equal(observed, table); items.push({ name: 'chest', count: 1 }) }
  assert.equal((await createReplacementChest(bot, origin)).name, 'chest')
})
