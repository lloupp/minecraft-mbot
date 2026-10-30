const test = require('node:test')
const assert = require('node:assert/strict')
const caps = require('../core/Capabilities')

test('lista as capacidades iniciais', () => {
  assert.deepEqual(caps.list().sort(), ['craft', 'deliver', 'deposit', 'gather', 'move_to', 'smelt', 'withdraw'])
})

test('valida argumentos por tipo', () => {
  assert.equal(caps.validateArgs('gather', { item: 'coal', quantity: 4 }), null)
  assert.equal(caps.validateArgs('gather', { item: '', quantity: 4 }), 'invalid_item')
  assert.equal(caps.validateArgs('gather', { item: 'coal', quantity: 0 }), 'invalid_quantity')
  assert.equal(caps.validateArgs('gather', { item: 'coal', quantity: 65 }), 'invalid_quantity')
  assert.equal(caps.validateArgs('move_to', { local: 'base' }), null)
  assert.equal(caps.validateArgs('nao_existe', {}), 'capability_desconhecida')
})

test('disponibilidade depende de spawn e estoque', () => {
  const bot = { entity: {} }
  const storage = { configured: () => true }
  assert.equal(caps.available('gather', { bot }), true)
  assert.equal(caps.available('gather', { bot: {} }), false)
  assert.equal(caps.available('deposit', { bot, storage }), true)
  assert.equal(caps.available('deposit', { bot, storage: { configured: () => false } }), false)
  assert.equal(caps.available('desconhecida', { bot }), false)
})

test('describe devolve cópia, não referência mutável', () => {
  const descriptor = caps.describe('gather')
  descriptor.name = 'alterado'
  assert.equal(caps.describe('gather').name, 'gather')
  assert.equal(caps.describe('gather').verifier, 'inventory_at_least')
  assert.equal(caps.describe('nao_existe'), null)
})
