const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { StorageManager } = require('../core/StorageManager')

function fixture(block) {
  const storage = new StorageManager()
  storage.setPosition({ x: 10, y: 64, z: 0 })
  const bot = { entity: { position: new Vec3(10, 64, 1) }, blockAt: () => block, findBlock: () => null, registry: { blocksByName: { chest: { id: 1 } } } }
  storage.goNear = async () => {}
  return { storage, bot }
}

test('confirmed missing stock is recovered once and opened at its new position', async () => {
  const { storage, bot } = fixture({ name: 'air' })
  const chest = { name: 'chest', position: new Vec3(11, 64, 0) }
  let repairs = 0
  storage.recoverContainer = async () => { repairs++; bot.blockAt = () => chest; return chest }
  bot.openContainer = async block => { assert.equal(block, chest); return { containerItems: () => [], close() {} } }
  await storage.summary(bot)
  assert.equal(repairs, 1)
  assert.deepEqual(storage.getPosition(), { x: 11, y: 64, z: 0 })
})

test('unloaded or distant stock never causes a replacement chest', async () => {
  for (const unloaded of [true, false]) {
    const { storage, bot } = fixture(unloaded ? null : { name: 'air' })
    if (!unloaded) bot.entity.position = new Vec3(300, 64, 0)
    let repairs = 0
    storage.recoverContainer = async () => { repairs++; return { name: 'chest', position: new Vec3(11, 64, 0) } }
    await assert.rejects(storage.summary(bot))
    assert.equal(repairs, 0)
    assert.deepEqual(storage.getPosition(), { x: 10, y: 64, z: 0 })
  }
})

test('food reserve is a total budget across stacks, not eight per stack', async () => {
  const storage = new StorageManager()
  storage.setPosition({ x: 0, y: 64, z: 0 })
  const rows = [{ name: 'bread', type: 1, count: 5 }, { name: 'bread', type: 1, count: 5 }, { name: 'apple', type: 2, count: 6 }, { name: 'torch', type: 3, count: 16 }]
  const moves = []
  storage.withContainer = async (_bot, fn) => fn({ deposit: async (type, _metadata, count) => moves.push([type, count]), containerItems: () => [] })
  const bot = { registry: { foodsByName: { bread: {}, apple: {} } }, inventory: { items: () => rows } }
  await storage.depositCargo(bot)
  assert.deepEqual(moves, [[1, 2], [2, 6], [3, 16]])
})
