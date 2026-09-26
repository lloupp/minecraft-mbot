// test/inventory-sync.test.js
// Tests for the inventory sync system.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { InventorySync } = require('../lib/inventory-sync')

const testLogPath = path.resolve('.data/test-inv-sync-events.jsonl')

test('start and stop work', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const sync = new InventorySync({
    storage: {
      setPosition: () => {},
      updateSnapshot: () => {},
      cachedSummary: () => ({})
    },
    bot: {
      entity: { position: { x: 0, y: 64, z: 0 } },
      inventory: { items: () => [], selectedItem: null },
      heldItem: null,
      closeWindow: () => {},
      waitForTicks: () => {}
    },
    eventLog: { log: () => {}, size: 0 },
    logger: { log: () => {} }
  })
  assert.equal(sync._running, false)
  sync.start()
  assert.equal(sync._running, true)
  sync.stop()
  assert.equal(sync._running, false)
  assert.equal(sync._timer, null)
})

test('sync mantém snapshot local e não sobrescreve o estoque central', () => {
  let storageWrites = 0
  const sync = new InventorySync({
    storage: {
      setPosition: () => {},
      updateSnapshot: () => { storageWrites++ },
      cachedSummary: () => ({ diamond: 64 })
    },
    bot: {
      entity: { position: { x: 0, y: 64, z: 0 } },
      inventory: { items: () => [{ name: 'coal', count: 3 }], selectedItem: null },
      heldItem: null,
      closeWindow: () => {},
      waitForTicks: () => {}
    },
    eventLog: { log: () => {}, size: 0 },
    logger: { log: () => {} }
  })
  sync.sync()
  assert.equal(storageWrites, 0)
  assert.deepEqual(sync.snapshot(), { coal: 3 })
  assert.equal(sync.verify().consistent, true)
})

test('stop clears timer', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const sync = new InventorySync({
    storage: {
      setPosition: () => {},
      updateSnapshot: () => {},
      cachedSummary: () => ({})
    },
    bot: {
      entity: { position: { x: 0, y: 64, z: 0 } },
      inventory: { items: () => [], selectedItem: null },
      heldItem: null,
      closeWindow: () => {},
      waitForTicks: () => {}
    },
    eventLog: { log: () => {}, size: 0 },
    logger: { log: () => {} }
  })
  sync.start()
  sync.stop()
  assert.equal(sync._timer, null)
})
