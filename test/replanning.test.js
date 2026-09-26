// test/replanning.test.js
// Tests for the replanning engine.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { ReplanningEngine } = require('../lib/replanning')

const testLogPath = path.resolve('.data/test-replan-events.jsonl')

test('starts and stops', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const engine = new ReplanningEngine({
    storage: { cachedSummary: () => ({}) },
    eventLog: { log: () => {}, size: 0, getEvents: () => [] },
    logger: { log: () => {} }
  })
  assert.equal(engine._running, false)
  engine.start(() => {}, () => {})
  assert.equal(engine._running, true)
  engine.stop()
  assert.equal(engine._running, false)
})

test('getTrigger returns initial when no prior stage', () => {
  const engine = new ReplanningEngine({
    storage: { cachedSummary: () => ({}) },
    eventLog: { log: () => {}, size: 0, getEvents: () => [] },
    logger: { log: () => {} }
  })
  const state = { stage: 'prepare' }
  const trigger = engine.getTrigger(state)
  assert.equal(trigger, 'initial')
})

test('getTrigger returns null when nothing changed', () => {
  const engine = new ReplanningEngine({
    storage: { cachedSummary: () => ({}) },
    eventLog: { log: () => {}, size: 0, getEvents: () => [] },
    logger: { log: () => {} }
  })
  engine._lastStage = 'travel'
  engine._lastPlanAt = Date.now()
  const state = { stage: 'travel' }
  const trigger = engine.getTrigger(state)
  assert.equal(trigger, null)
})

test('recordResult tracks successes and failures', () => {
  const engine = new ReplanningEngine({
    storage: { cachedSummary: () => ({}) },
    eventLog: { log: () => {}, size: 0, getEvents: () => [] },
    logger: { log: () => {} }
  })
  engine.recordResult(true)
  assert.equal(engine.failureCount, 0)
  engine.recordResult(false)
  engine.recordResult(false)
  assert.equal(engine.failureCount, 2)
})

test('getTrigger returns repeated_failure after threshold', () => {
  const engine = new ReplanningEngine({
    storage: { cachedSummary: () => ({}) },
    eventLog: { log: () => {}, size: 0, getEvents: () => [] },
    logger: { log: () => {} }
  })
  engine._lastStage = 'prepare'
  engine._consecutiveFailures = 2
  engine._lastPlanAt = Date.now() - 20000
  const state = { stage: 'prepare' }
  const trigger = engine.getTrigger(state)
  assert.equal(trigger, 'repeated_failure')
})

test('getTrigger returns dimension_changed when stage changes', () => {
  const engine = new ReplanningEngine({
    storage: { cachedSummary: () => ({}) },
    eventLog: { log: () => {}, size: 0, getEvents: () => [] },
    logger: { log: () => {} }
  })
  engine._lastStage = 'overworld'
  const state = { stage: 'the_nether' }
  const trigger = engine.getTrigger(state)
  assert.equal(trigger, 'dimension_changed')
})

test('pending is false when not planning', () => {
  const engine = new ReplanningEngine({
    storage: { cachedSummary: () => ({}) },
    eventLog: { log: () => {}, size: 0, getEvents: () => [] },
    logger: { log: () => {} }
  })
  assert.equal(engine._pending, null)
})

test('getTrigger returns periodic_review after 120s', () => {
  const engine = new ReplanningEngine({
    storage: { cachedSummary: () => ({}) },
    eventLog: { log: () => {}, size: 0, getEvents: () => [] },
    logger: { log: () => {} }
  })
  engine._lastStage = 'prepare'
  engine._lastPlanAt = Date.now() - 130000
  const state = { stage: 'prepare' }
  const trigger = engine.getTrigger(state)
  assert.equal(trigger, 'periodic_review')
})
