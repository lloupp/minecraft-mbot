'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { candidateIntents, applyIntent } = require('../lib/player-loop')

test('recoverable repeated route failure exposes replan but not stop_task', () => {
  const state = {
    health: 20,
    food: 18,
    inventory: { stone_sword: 1 },
    equippedWeapon: 'stone_sword',
    consecutiveFailures: 4,
    alternativeRoute: true,
    objective: { type: 'explore', progress: 0, target: 1, completed: false }
  }

  const ids = candidateIntents(state).map(candidate => candidate.id)
  assert.deepEqual(ids, ['replan_route'])
})

test('stop_task remains available when repeated failure has no recovery route', () => {
  const state = {
    health: 20,
    food: 18,
    inventory: { stone_sword: 1 },
    equippedWeapon: 'stone_sword',
    consecutiveFailures: 4,
    alternativeRoute: false,
    objective: { type: 'explore', progress: 0, target: 1, completed: false }
  }

  const ids = candidateIntents(state).map(candidate => candidate.id)
  assert.deepEqual(ids, ['stop_task'])
})

test('replan_route clears the failure streak and records recovery', () => {
  const state = {
    health: 20,
    food: 18,
    inventory: {},
    consecutiveFailures: 4,
    alternativeRoute: true,
    objective: { type: 'explore', progress: 0, target: 1, completed: false }
  }

  const { state: next, result } = applyIntent(state, 'replan_route')
  assert.equal(result.ok, true)
  assert.equal(next.consecutiveFailures, 0)
  assert.equal(next.alternativeRoute, false)
  assert.equal(next.routeReplanned, true)
  assert.equal(next.objective.completed, false)
})
