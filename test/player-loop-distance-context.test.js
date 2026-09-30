'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { candidateIntents } = require('../lib/player-loop')

test('hunger candidates expose nearby-food and base distances to the model', () => {
  const state = {
    health: 20,
    food: 6,
    inventory: {},
    nearby: { food: true, foodDistance: 3 },
    baseKnown: true,
    baseDistance: 40,
    objective: { type: 'explore', completed: false }
  }

  const byId = Object.fromEntries(candidateIntents(state).map((candidate) => [candidate.id, candidate.description]))
  assert.match(byId.find_food, /3\.0 blocks away/)
  assert.match(byId.return_base, /40\.0 blocks away/)
})
