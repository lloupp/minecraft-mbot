const test = require('node:test')
const assert = require('node:assert/strict')

const { loadPlugins } = require('../lib/plugins')

test('carrega os plugins prontos no bot', () => {
  const loadedFns = []
  const autoEat = { setOpts: () => {}, on: () => {}, enableAuto: () => {}, disableAuto: () => {} }
  const bot = { loadPlugin: (fn) => loadedFns.push(fn), autoEat }
  const loaded = loadPlugins(bot, { log: () => {}, autoEatEnabled: false, only: null, skip: '' })
  assert.deepEqual(loaded, ['pvp', 'custompvp', 'tool', 'collectblock', 'hawkeye'])
  assert.ok(loadedFns.every((fn) => typeof fn === 'function'))
})

test('um plugin que falha não impede os outros', () => {
  const logs = []
  let calls = 0
  const bot = { loadPlugin: () => { if (calls++ === 0) throw new Error('versão sem suporte') } }
  const loaded = loadPlugins(bot, { log: (m) => logs.push(m), autoEatEnabled: false, only: null, skip: '' })
  assert.equal(loaded.length, 4)
  assert.ok(logs.some((m) => m.includes('pvp indisponível')))
})

test('autoeat só carrega por opt-in explícito', () => {
  let enabled = 0
  const bot = { loadPlugin() {}, autoEat: { setOpts() {}, on() {}, enableAuto() { enabled++ }, disableAuto() {} } }
  const disabled = loadPlugins(bot, { log: () => {}, autoEatEnabled: false, only: 'autoeat' })
  assert.deepEqual(disabled, [])
  assert.equal(enabled, 0)
  const loaded = loadPlugins(bot, { log: () => {}, autoEatEnabled: true, only: 'autoeat' })
  assert.deepEqual(loaded, ['autoeat'])
  assert.equal(enabled, 1)
})

test('plugin isolation e SKIP prevalecem em conjunto', () => {
  const bot = { loadPlugin() {} }
  assert.deepEqual(loadPlugins(bot, { log: () => {}, autoEatEnabled: false, only: 'pvp,tool', skip: 'tool' }), ['pvp'])
  assert.deepEqual(loadPlugins(bot, { log: () => {}, only: '', skip: '' }), [])
  assert.deepEqual(loadPlugins(bot, { log: () => {}, enabled: false, only: 'pvp' }), [])
})
