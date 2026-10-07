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
