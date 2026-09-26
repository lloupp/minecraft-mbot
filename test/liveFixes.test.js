const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')

const craft = require('../lib/craft')
const { hasFallingAbove, FALLING } = require('../lib/gather')

test('smeltItem usa o id do registro como itemType da fornalha', async () => {
  const rawIron = { id: 101, name: 'raw_iron' }
  const coal = { type: 202, name: 'coal', count: 1 }
  const inventory = [
    { type: 101, name: 'raw_iron', count: 1 },
    coal
  ]
  const furnaceBlock = { name: 'furnace', position: new Vec3(1, 64, 0) }
  let inputArgs = null
  let fuelArgs = null

  const furnace = {
    fuelItem: () => null,
    putFuel: async (...args) => { fuelArgs = args },
    putInput: async (...args) => { inputArgs = args },
    outputItem: () => ({ name: 'iron_ingot', count: 1 }),
    takeOutput: async () => ({ name: 'iron_ingot', count: 1 }),
    close: () => {}
  }

  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    registry: {
      itemsByName: {
        raw_iron: rawIron,
        furnace: { id: 303, name: 'furnace' }
      },
      blocksByName: {
        furnace: { id: 404, name: 'furnace' }
      }
    },
    inventory: { items: () => inventory },
    findBlock: ({ matching }) => matching === 404 ? furnaceBlock : null,
    pathfinder: {
      goto: async () => {},
      setGoal: () => {}
    },
    openFurnace: async () => furnace
  }

  const produced = await craft.smeltItem(bot, 'raw_iron', 1, () => false)

  assert.equal(produced, 1)
  assert.deepEqual(inputArgs, [101, null, 1])
  assert.deepEqual(fuelArgs, [202, null, 1])
})

test('hasFallingAbove detecta areia e cascalho sobre o bloco alvo', () => {
  const target = new Vec3(0, 63, 0)
  const above = target.offset(0, 1, 0)
  const bot = {
    blockAt: (pos) => ({
      name: pos.equals(above) ? 'gravel' : 'stone'
    })
  }

  assert.equal(FALLING.has('sand'), true)
  assert.equal(FALLING.has('gravel'), true)
  assert.equal(hasFallingAbove(bot, target), true)
})

test('hasFallingAbove permite teto sólido estável', () => {
  const target = new Vec3(0, 63, 0)
  const bot = { blockAt: () => ({ name: 'stone' }) }
  assert.equal(hasFallingAbove(bot, target), false)
})
