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


test('gather_materials exposes observed resource names and distances to the model', () => {
  const state = {
    health: 20,
    food: 20,
    inventory: {},
    nearby: {
      wood: true,
      woodDistance: 2,
      stone: true,
      stoneDistance: 5.7,
      iron: false,
      ironDistance: null
    },
    baseKnown: true,
    baseDistance: 200,
    objective: { type: 'explore', completed: false }
  }

  const byId = Object.fromEntries(candidateIntents(state).map((candidate) => [candidate.id, candidate.description]))
  assert.match(byId.gather_materials, /wood approximately 2\.0 blocks away/)
  assert.match(byId.gather_materials, /stone approximately 5\.7 blocks away/)
  assert.doesNotMatch(byId.gather_materials, /iron/)
})

test('gather_materials reports observed material even when distance is unavailable', () => {
  const state = {
    health: 20,
    food: 20,
    inventory: {},
    nearby: { wood: true, woodDistance: null },
    objective: { type: 'explore', completed: false }
  }

  const gather = candidateIntents(state).find((candidate) => candidate.id === 'gather_materials')
  assert.match(gather.description, /wood nearby/)
})
