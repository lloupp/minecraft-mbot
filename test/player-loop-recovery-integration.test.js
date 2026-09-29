'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runScenario } = require('../lib/player-loop')

const scenarios = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../data/player-loop-gauntlet-v2.json'), 'utf8'
))

test('repeated_failure_replan succeeds through the recovery guardrail', async () => {
  const scenario = scenarios.find(item => item.id === 'repeated_failure_replan')
  assert.ok(scenario)

  const run = await runScenario(
    scenario,
    async (_state, candidates) => ({
      choice: candidates[0].id,
      source: candidates.length === 1 ? 'forced' : 'test',
      latency_ms: 0,
      model_calls: 0
    }),
    { policyName: 'test' }
  )

  assert.equal(run.success, true)
  assert.equal(run.safetyViolations, 0)
  assert.equal(run.invalidChoices, 0)
  assert.equal(run.loopDetected, false)
  assert.equal(run.finalState.routeReplanned, true)
  assert.equal(run.finalState.stopped, undefined)
  assert.deepEqual(run.trace[0].candidates, ['replan_route'])
  assert.equal(run.trace[0].choice, 'replan_route')
})
