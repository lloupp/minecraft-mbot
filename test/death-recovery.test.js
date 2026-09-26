// test/death-recovery.test.js
// Tests for the death recovery system.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { DeathRecovery } = require('../lib/death-recovery')

const testLogPath = path.resolve('.data/test-death-events.jsonl')

test('records death with position and inventory', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const recovery = new DeathRecovery({
    storage: { summary: () => ({}) },
    eventLog: { log: () => {} },
    logger: { log: () => {} }
  })
  const result = recovery.recordDeath('worker_01', { x: 100, y: 64, z: 200 }, { diamond_pickaxe: 1 })
  assert.equal(result.recovered, false)
  assert.equal(result.reason, 'recorded')
  assert.equal(result.position.position.x, 100)
})

test('getDeathRecord returns the recorded death', () => {
  const recovery = new DeathRecovery({
    storage: { summary: () => ({}) },
    eventLog: { log: () => {} },
    logger: { log: () => {} }
  })
  recovery.recordDeath('worker_01', { x: 10, y: 64, z: 20 }, { diamond: 1 })
  const record = recovery.getDeathRecord('worker_01')
  assert.ok(record)
  assert.equal(record.position.x, 10)
})

test('getDeathRecord returns null for unknown worker', () => {
  const recovery = new DeathRecovery({
    storage: { summary: () => ({}) },
    eventLog: { log: () => {} },
    logger: { log: () => {} }
  })
  const record = recovery.getDeathRecord('unknown')
  assert.equal(record, null)
})

test('clearDeathRecord removes a record', () => {
  const recovery = new DeathRecovery({
    storage: { summary: () => ({}) },
    eventLog: { log: () => {} },
    logger: { log: () => {} }
  })
  recovery.recordDeath('worker_01', { x: 0, y: 64, z: 0 }, {})
  assert.ok(recovery.getDeathRecord('worker_01'))
  recovery.clearDeathRecord('worker_01')
  assert.equal(recovery.getDeathRecord('worker_01'), null)
})

test('deathCount reflects records', () => {
  const recovery = new DeathRecovery({
    storage: { summary: () => ({}) },
    eventLog: { log: () => {} },
    logger: { log: () => {} }
  })
  assert.equal(recovery.deathCount, 0)
  recovery.recordDeath('w1', { x: 0, y: 64, z: 0 }, {})
  recovery.recordDeath('w2', { x: 1, y: 64, z: 0 }, {})
  assert.equal(recovery.deathCount, 2)
})
