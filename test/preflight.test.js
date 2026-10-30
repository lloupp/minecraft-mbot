const test = require('node:test')
const assert = require('node:assert/strict')
const { check } = require('../lib/preflight')

function bot(overrides = {}) {
  return {
    entity: {},
    health: 20,
    food: 20,
    game: { dimension: 'overworld' },
    inventory: {
      items: () => [{ name: 'wooden_pickaxe', count: 1 }],
      emptySlotCount: () => 10
    },
    ...overrides
  }
}

test('bot pronto passa', () => {
  const result = check(bot(), { item: 'oak_log', quantity: 4 }, {
    registry: { itemsByName: { oak_log: {} }, blocksByName: {} },
    storage: { configured: () => true }
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.blockers, [])
})

test('sem spawn, morto, fome, slots e ferramenta viram blockers', () => {
  const result = check(bot({ entity: null }), { longTask: true, tools: ['stone_pickaxe'], minFreeSlots: 3 })
  const codes = result.blockers.map((item) => item.code)
  assert.ok(codes.includes('NOT_SPAWNED'))
  assert.ok(codes.includes('TOOL_MISSING'))
})

test('vida zerada e dimensão errada são recusadas', () => {
  const result = check(bot({ health: 0, game: { dimension: 'the_nether' } }), { dimension: 'overworld' })
  const codes = result.blockers.map((item) => item.code)
  assert.ok(codes.includes('DEAD'))
  assert.ok(codes.includes('WRONG_DIMENSION'))
})

test('fome baixa só bloqueia tarefa longa', () => {
  const hungry = bot({ food: 4 })
  assert.equal(check(hungry, { longTask: false }).ok, true)
  assert.equal(check(hungry, { longTask: true }).blockers[0].code, 'FOOD_MISSING')
})

test('estoque ausente bloqueia entrega', () => {
  const result = check(bot(), { requiresStorage: true }, { storage: null })
  assert.equal(result.blockers[0].code, 'CONTAINER_UNREACHABLE')
})

test('item fora do registry é recusado', () => {
  const result = check(bot(), { item: 'nao_existe' }, { registry: { itemsByName: {}, blocksByName: {} } })
  assert.equal(result.blockers[0].code, 'RESOURCE_NOT_FOUND')
})

test('quantidade inválida é recusada quando exigida', () => {
  const result = check(bot(), { requiresQuantity: true, quantity: 0 })
  assert.equal(result.blockers[0].code, 'UNKNOWN')
})
