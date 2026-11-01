const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const craft = require('../lib/craft')

// Bot falso: receita de tábuas na grade 2x2 (1 tronco -> 4 tábuas).
function fakeBot({ logs = 3 } = {}) {
  const LOG = 1
  const PLANKS = 2
  const inv = [{ name: 'oak_log', type: LOG, count: logs }]
  const recipe = { result: { id: PLANKS, count: 4 }, delta: [{ id: LOG, count: -1 }, { id: PLANKS, count: 4 }], requiresTable: false }
  const calls = []
  const add = (type, name, n) => {
    const item = inv.find((i) => i.type === type)
    if (item) item.count += n
    else inv.push({ name, type, count: n })
  }
  const bot = {
    calls,
    entity: { position: new Vec3(0, 64, 0) },
    entities: {},
    currentWindow: null,
    registry: { itemsByName: { oak_log: { id: LOG, name: 'oak_log' }, oak_planks: { id: PLANKS, name: 'oak_planks' } }, items: { [LOG]: { name: 'oak_log' }, [PLANKS]: { name: 'oak_planks' } } },
    inventory: { items: () => inv.filter((i) => i.count > 0) },
    recipesAll: (id) => (id === PLANKS ? [recipe] : []),
    craft: async (r, times) => {
      calls.push(['craft', times])
      add(LOG, 'oak_log', -times)
      add(PLANKS, 'oak_planks', 4 * times)
    },
    _client: { write: (name, data) => calls.push([name, data.windowId]) },
    _syncWindow: async () => { calls.push(['sync']) }
  }
  return bot
}

test('na grade 2x2 fabrica uma unidade por vez, devolvendo a grade e sincronizando entre elas', async () => {
  const bot = fakeBot({ logs: 3 })
  await craft.craftItem(bot, 'oak_planks', 12, () => false)
  const crafts = bot.calls.filter(([name]) => name === 'craft')
  assert.deepEqual(crafts, [['craft', 1], ['craft', 1], ['craft', 1]])
  // Depois de cada craft: fecha a tela do inventário (janela 0) e pede o inventário ao servidor.
  const afterFirst = bot.calls.slice(bot.calls.findIndex(([n]) => n === 'craft') + 1, bot.calls.findIndex(([n]) => n === 'craft') + 3)
  assert.deepEqual(afterFirst, [['close_window', 0], ['sync']])
  assert.equal(bot.inventory.items().find((i) => i.name === 'oak_planks').count, 12)
})

test('falha de craft na grade também devolve a grade antes de replanejar', async () => {
  const bot = fakeBot({ logs: 1 })
  let first = true
  const real = bot.craft
  bot.craft = async (...args) => {
    if (first) { first = false; bot.calls.push(['craft-fail']); throw new Error('Event updateSlot:0 did not fire within timeout of 5000ms') }
    return real(...args)
  }
  await craft.craftItem(bot, 'oak_planks', 4, () => false)
  const failAt = bot.calls.findIndex(([n]) => n === 'craft-fail')
  assert.deepEqual(bot.calls[failAt + 1], ['close_window', 0])
  assert.equal(bot.inventory.items().find((i) => i.name === 'oak_planks').count, 4)
})
