const test = require('node:test')
const assert = require('node:assert/strict')
const spec = require('../lib/mission-spec')

test('pegar resolve alias, quantidade e guardar', () => {
  const parsed = spec.parse(['pegar', 'carvão', '4', 'guardar'])
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.spec, { verb: 'pegar', item: 'coal', quantity: 4, delivery: 'chest' })
})

test('coletar sem guardar não cria depósito', () => {
  const parsed = spec.parse(['coletar', 'ferro', '8'])
  assert.equal(parsed.ok, true)
  assert.equal(parsed.spec.item, 'iron_ingot')
  assert.equal(parsed.spec.delivery, null)
})

test('quantidade inválida e verbo desconhecido são recusados', () => {
  assert.equal(spec.parse(['pegar', 'carvao', '0']).ok, false)
  assert.equal(spec.parse(['pegar', 'carvao', '65']).ok, false)
  assert.equal(spec.parse(['voar', 'carvao', '1']).ok, false)
  assert.equal(spec.parse(['pegar']).ok, false)
})

test('entregar distingue baú e mão', () => {
  assert.equal(spec.parse(['entregar', 'pao', '8']).spec.mode, 'chest')
  assert.equal(spec.parse(['entregar', 'pao', '8', 'mao']).spec.mode, 'hand')
})

test('ir exige local', () => {
  assert.equal(spec.parse(['ir']).ok, false)
  assert.deepEqual(spec.parse(['ir', 'base']).spec, { verb: 'ir', local: 'base' })
})

test('grafo de coleta com guardar tem dependência', () => {
  const nodes = spec.graphForSpec({ verb: 'pegar', item: 'coal', quantity: 4, delivery: 'chest' })
  assert.equal(nodes.length, 2)
  assert.deepEqual(nodes[0].dependsOn, [])
  assert.deepEqual(nodes[1].dependsOn, ['coletar'])
  assert.equal(nodes[0].action, 'gather')
  assert.equal(nodes[1].action, 'deposit')
  assert.equal(nodes[1].verify, 'container_contains')
})

test('grafo de fabricação e entrega', () => {
  const craft = spec.graphForSpec({ verb: 'fabricar', item: 'iron_pickaxe', quantity: 1 })
  assert.equal(craft.length, 1)
  assert.equal(craft[0].action, 'craft')
  const deliver = spec.graphForSpec({ verb: 'entregar', item: 'bread', quantity: 8, mode: 'chest' })
  assert.equal(deliver[0].action, 'deliver')
  assert.equal(deliver[0].verify, 'inventory_removed')
  assert.equal(deliver[0].args.mode, 'chest')
})

test('describe resume a missão em uma linha', () => {
  assert.match(spec.describe({ verb: 'pegar', item: 'coal', quantity: 4, delivery: 'chest' }), /carvão|coal/)
  assert.match(spec.describe({ verb: 'ir', local: 'base' }), /base/)
})
