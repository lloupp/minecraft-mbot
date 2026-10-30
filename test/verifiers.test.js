const test = require('node:test')
const assert = require('node:assert/strict')
const { verify, inventoryAtLeast, inventoryRemoved, containerContains, positionNear } = require('../lib/verifiers')

test('inventory_at_least aceita item que já estava na mochila', async () => {
  const node = { args: { item: 'dirt', quantity: 1 } }
  const ok = await inventoryAtLeast(node, { before: 1, after: 1 })
  assert.equal(ok.ok, true)
  const bad = await inventoryAtLeast(node, { before: 0, after: 0 })
  assert.equal(bad.ok, false)
})

test('inventory_at_least relê o inventário quando o executor não informa', async () => {
  const node = { args: { item: 'coal', quantity: 2 } }
  const bot = { inventory: { items: () => [{ name: 'coal', count: 3 }] } }
  assert.equal((await inventoryAtLeast(node, { bot })).ok, true)
})

test('inventory_removed exige prova de saída', async () => {
  const node = { args: { item: 'coal', quantity: 4 } }
  assert.equal((await inventoryRemoved(node, { before: 4, after: 0 })).ok, true)
  assert.equal((await inventoryRemoved(node, { before: 4, after: 2 })).ok, false)
  assert.equal((await inventoryRemoved(node, { after: 0 })).ok, false)
})

test('container_contains lê o baú de verdade', async () => {
  const node = { args: { item: 'coal', quantity: 4 } }
  const storage = { summary: async () => ({ coal: 4 }) }
  assert.equal((await containerContains(node, { bot: {}, storage })).ok, true)
  const storageShort = { summary: async () => ({ coal: 3 }) }
  assert.equal((await containerContains(node, { bot: {}, storage: storageShort })).ok, false)
})

test('position_near calcula distância real', () => {
  const node = { args: { quantity: 1 } }
  const bot = { entity: { position: { x: 0, y: 64, z: 0 } } }
  assert.equal(positionNear(node, { bot, target: { x: 2, y: 64, z: 0 }, range: 3 }).ok, true)
  assert.equal(positionNear(node, { bot, target: { x: 9, y: 64, z: 0 }, range: 3 }).ok, false)
})

test('verificador desconhecido falha em vez de aprovar', async () => {
  const result = await verify('inexistente', { args: {} }, {})
  assert.equal(result.ok, false)
})
