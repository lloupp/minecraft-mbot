'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { candidateIntents, immediateSafety } = require('../lib/player-loop')

function state(extra = {}) {
  return {
    health: 20,
    food: 5,
    inventory: {},
    nearby: { food: true, foodDistance: 2 },
    baseKnown: true,
    baseDistance: 40,
    objective: { type: 'explore', completed: false },
    ...extra
  }
}

test('critical hunger forces nearby food when it is close and base is farther', () => {
  const s = state()
  assert.equal(immediateSafety(s), 'find_food')
  assert.deepEqual(candidateIntents(s).map((c) => c.id), ['find_food'])
})

test('moderate hunger remains model-observable', () => {
  const s = state({ food: 6 })
  assert.equal(immediateSafety(s), null)
  assert.deepEqual(candidateIntents(s).map((c) => c.id), ['find_food', 'return_base'])
})

test('critical hunger does not force food when base is closer', () => {
  const s = state({ nearby: { food: true, foodDistance: 7 }, baseDistance: 3 })
  assert.equal(immediateSafety(s), null)
  assert.deepEqual(candidateIntents(s).map((c) => c.id), ['find_food', 'return_base'])
})

test('critical hunger does not force distant food beyond bounded nearby radius', () => {
  const s = state({ nearby: { food: true, foodDistance: 9 }, baseDistance: 40 })
  assert.equal(immediateSafety(s), null)
  assert.deepEqual(candidateIntents(s).map((c) => c.id), ['find_food', 'return_base'])
})


test('threat handling takes precedence over critical hunger guardrail', () => {
  const s = state({
    threat: { type: 'zombie', distance: 7, count: 1 }
  })
  assert.equal(immediateSafety(s), null)
  const ids = candidateIntents(s).map((c) => c.id)
  assert.ok(ids.includes('escape_danger'))
  assert.ok(!ids.includes('find_food'))
})

test('critical hunger resumes once no threat remains', () => {
  const s = state({ threat: null })
  assert.equal(immediateSafety(s), 'find_food')
  assert.deepEqual(candidateIntents(s).map((c) => c.id), ['find_food'])
})
