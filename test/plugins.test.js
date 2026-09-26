const test = require('node:test')
const assert = require('node:assert/strict')

const { loadPlugins } = require('../lib/plugins')

test('carrega os plugins prontos no bot', () => {
  const loadedFns = []
  const bot = { loadPlugin: (fn) => loadedFns.push(fn) }
  const loaded = loadPlugins(bot, { log: () => {} })
  assert.deepEqual(loaded, ['pvp', 'custompvp', 'tool', 'collectblock', 'hawkeye'])
  assert.ok(loadedFns.every((fn) => typeof fn === 'function'))
})

test('um plugin que falha não impede os outros', () => {
  const logs = []
  let calls = 0
  const bot = { loadPlugin: () => { if (calls++ === 0) throw new Error('versão sem suporte') } }
  const loaded = loadPlugins(bot, { log: (m) => logs.push(m) })
  assert.equal(loaded.length, 4)
  assert.ok(logs.some((m) => m.includes('pvp indisponível')))
})
