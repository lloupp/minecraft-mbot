const test = require('node:test')
const assert = require('node:assert/strict')
const { ProductionManager } = require('../core/ProductionManager')

function botWithInventory(itemsRef) {
  return { inventory: { items: () => itemsRef.items } }
}

test('craftToStorage confirms success from observed inventory delta', async () => {
  const itemsRef = { items: [] }
  const pm = new ProductionManager({ storage: null })
  pm.craftInternal = async () => {
    itemsRef.items = [{ name: 'stick', count: 4 }]
    return { item: 'stick', requested: 4, produced: 4, runs: 2 }
  }
  const result = await pm.craftToStorage(botWithInventory(itemsRef), 'stick', 4)
  assert.equal(result.ok, true)
  assert.equal(result.verified, true)
  assert.equal(result.inventoryDelta, 4)
  assert.equal(result.itemConfirmed, true)
})

test('craftToStorage rejects predicted production without physical item confirmation', async () => {
  const itemsRef = { items: [] }
  const pm = new ProductionManager({ storage: null })
  pm.craftInternal = async () => ({ item: 'stick', requested: 4, produced: 4, runs: 2 })
  const result = await pm.craftToStorage(botWithInventory(itemsRef), 'stick', 4)
  assert.equal(result.ok, false)
  assert.equal(result.verified, false)
  assert.equal(result.code, 'CRAFT_ITEM_NOT_CONFIRMED')
})

test('craftToStorage requires storage confirmation when storage is configured', async () => {
  const itemsRef = { items: [] }
  const storage = {
    configured: () => true,
    async deposit() { return 0 }
  }
  const pm = new ProductionManager({ storage })
  pm.craftInternal = async () => {
    itemsRef.items = [{ name: 'stick', count: 4 }]
    return { item: 'stick', requested: 4, produced: 4, runs: 2 }
  }
  const result = await pm.craftToStorage(botWithInventory(itemsRef), 'stick', 4)
  assert.equal(result.itemConfirmed, true)
  assert.equal(result.storageConfirmed, false)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'CRAFT_STORAGE_NOT_CONFIRMED')
})
