const test = require('node:test')
const assert = require('node:assert/strict')

const fear = require('../lib/fear-mode')

test('por padrão o bot continua com os reflexos de sempre', () => {
  assert.equal(fear.fearless({}), false)
  assert.equal(fear.shouldEngage({ threat: { name: 'zombie' } }), true)
  assert.equal(fear.shouldShelter({ isNight: true }), true)
})

test('MBOT_FEARLESS=1 desliga fuga, briga automática e abrigo', () => {
  const env = { MBOT_FEARLESS: '1' }
  assert.equal(fear.fearless(env), true)
  assert.equal(fear.shouldEngage({ fearless: true, threat: { name: 'zombie' } }), false)
  assert.equal(fear.shouldShelter({ fearless: true, isNight: true }), false)
})

test('sem ameaça ou de dia nada muda mesmo sem medo', () => {
  assert.equal(fear.shouldEngage({ fearless: true, threat: null }), false)
  assert.equal(fear.shouldShelter({ fearless: true, isNight: false }), false)
})

test('qualquer outro valor mantém o comportamento padrão', () => {
  for (const value of ['0', 'false', '', 'sim']) {
    assert.equal(fear.fearless({ MBOT_FEARLESS: value }), false, value)
  }
})

test('a variável é lida de process.env quando não é passada', () => {
  const previous = process.env.MBOT_FEARLESS
  process.env.MBOT_FEARLESS = '1'
  try {
    assert.equal(fear.fearless(), true)
  } finally {
    if (previous === undefined) delete process.env.MBOT_FEARLESS
    else process.env.MBOT_FEARLESS = previous
  }
})

test('criativo e espectador contam como invulneráveis; sobrevivência não', () => {
  assert.equal(fear.invulnerable({ game: { gameMode: 'creative' } }, {}), true)
  assert.equal(fear.invulnerable({ game: { gameMode: 'spectator' } }, {}), true)
  assert.equal(fear.invulnerable({ game: { gameMode: 'survival' } }, {}), false)
  assert.equal(fear.invulnerable({ game: { gameMode: 'survival' } }, { MBOT_FEARLESS: '1' }), true)
  assert.equal(fear.invulnerable(null, {}), false)
})

test('Resistência V do servidor também conta como invencível', () => {
  const registry = { effectsByName: { Resistance: { id: 11 } } }
  assert.equal(fear.invulnerable({ registry, game: { gameMode: 'survival' }, entity: { effects: { 11: { amplifier: 4 } } } }, {}), true)
  assert.equal(fear.invulnerable({ registry, game: { gameMode: 'survival' }, entity: { effects: { 11: { amplifier: 1 } } } }, {}), false)
  assert.equal(fear.invulnerable({ registry, game: { gameMode: 'survival' }, entity: { effects: {} } }, {}), false)
})
