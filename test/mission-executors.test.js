const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { createExecutors } = require('../core/mission-executors')

function makeBot() {
  const items = []
  const bot = {
    inventory: { items: () => items.filter((item) => item.count > 0) },
    registry: {
      blocksArray: [{ name: 'coal_ore', drops: [1] }],
      blocksByName: {},
      items: { 1: { name: 'coal' } }
    },
    entity: { position: new Vec3(0, 64, 0) },
    pathfinder: { async goto() {}, setGoal() {} },
    game: { dimension: 'overworld' }
  }
  return { bot, items }
}

function executorsFor(bot, overrides = {}) {
  return createExecutors({
    bot,
    gather: { mineBlocks: async () => 0 },
    craft: { craftItem: async () => {}, smeltItem: async () => {} },
    production: { craftInternal: async () => {} },
    handover: {
      DELIVERY_CHEST: { x: 0, y: 64, z: 0 },
      deliverTo: async () => ({ ok: true, delivered: 4 }),
      depositAtChest: async () => ({ ok: true, deposited: 4, inside: 4 })
    },
    goals: { GoalNear: class GoalNear { constructor(...args) { this.args = args } } },
    logger: { log: () => {} },
    ...overrides
  })
}

test('gather confirma pelo delta do inventário', async () => {
  const { bot, items } = makeBot()
  const executors = executorsFor(bot, {
    gather: { mineBlocks: async (_bot, predicate, count) => { items.push({ name: 'coal', count }); return count } }
  })
  const result = await executors.gather({ args: { item: 'coal', quantity: 4 } }, {})
  assert.equal(result.ok, true)
  assert.deepEqual(result.evidence, { before: 0, after: 4, mined: 4, needed: 4 })
})

test('gather sem bloco que dê o item é RESOURCE_NOT_FOUND', async () => {
  const { bot } = makeBot()
  const executors = executorsFor(bot)
  const result = await executors.gather({ args: { item: 'diamond', quantity: 1 } }, {})
  assert.equal(result.ok, false)
  assert.equal(result.code, 'RESOURCE_NOT_FOUND')
})

test('craft usa a cadeia do ProductionManager e confirma delta', async () => {
  const { bot, items } = makeBot()
  const executors = executorsFor(bot, {
    production: { craftInternal: async () => { items.push({ name: 'stick', count: 4 }) } }
  })
  const result = await executors.craft({ args: { item: 'stick', quantity: 4 } }, {})
  assert.equal(result.ok, true)
  assert.equal(result.evidence.after, 4)
})

test('deposit exige contagem no baú depois do depósito', async () => {
  const { bot, items } = makeBot()
  items.push({ name: 'coal', count: 4 })
  const executors = executorsFor(bot, {
    storage: {
      configured: () => true,
      depositMany: async () => ({ coal: 4 }),
      summary: async () => ({ coal: 4 })
    }
  })
  const result = await executors.deposit({ args: { item: 'coal', quantity: 4 } }, {})
  assert.equal(result.ok, true)
  assert.equal(result.evidence.deposited, 4)
})

test('withdraw confirma o que entrou na mochila', async () => {
  const { bot, items } = makeBot()
  const executors = executorsFor(bot, {
    storage: {
      configured: () => true,
      withdraw: async () => { items.push({ name: 'coal', count: 4 }); return 4 }
    }
  })
  const result = await executors.withdraw({ args: { item: 'coal', quantity: 4 } }, {})
  assert.equal(result.ok, true)
  assert.equal(result.evidence.got, 4)
})

test('entregar na mão só confirma com delivered completo', async () => {
  const { bot, items } = makeBot()
  items.push({ name: 'coal', count: 4 })
  const executors = executorsFor(bot, {
    ownerProvider: () => ({ position: { x: 0, y: 64, z: 0 } }),
    handover: {
      DELIVERY_CHEST: { x: 0, y: 64, z: 0 },
      deliverTo: async () => ({ ok: true, delivered: 4 }),
      depositAtChest: async () => ({ ok: true, deposited: 4, inside: 4 })
    }
  })
  const result = await executors.deliver({ args: { item: 'coal', quantity: 4, mode: 'hand' } }, {})
  assert.equal(result.ok, true)
})

test('move_to confirma posição e dimensão', async () => {
  const { bot } = makeBot()
  const executors = executorsFor(bot, {
    waypointManager: {
      get: () => ({ position: { x: 0, y: 64, z: 0 } }),
      sameDimension: () => true
    }
  })
  const result = await executors.move_to({ args: { local: 'base' } }, { isCancelled: () => false })
  assert.equal(result.ok, true)
  assert.equal(result.evidence.distance, 0)
})

test('move_to recusa local desconhecido', async () => {
  const { bot } = makeBot()
  const executors = executorsFor(bot, { waypointManager: { get: () => null } })
  const result = await executors.move_to({ args: { local: 'nada' } }, {})
  assert.equal(result.ok, false)
  assert.equal(result.code, 'RESOURCE_NOT_FOUND')
})
