const test = require('node:test')
const assert = require('node:assert/strict')
const scenarios = require('../data/player-loop-gauntlet-v2.json')
const {
  candidateIntents,
  deterministicPlayerPolicy,
  runScenario,
  summarizeRuns
} = require('../lib/player-loop')

function byId(id) {
  const scenario = scenarios.find(item => item.id === id)
  assert.ok(scenario, `missing scenario ${id}`)
  return scenario
}

test('critical creeper is handled by forced escape, not model choice', () => {
  const state = byId('creeper_critical').initialState
  assert.deepEqual(
    candidateIntents(state).map(item => item.id),
    ['escape_danger']
  )
})

test('wait is unavailable without a concrete wait reason', () => {
  const state = {
    health: 20,
    food: 18,
    inventory: { stone_sword: 1 },
    equippedWeapon: 'stone_sword',
    objective: { type: 'explore', progress: 0, target: 1, completed: false },
    time: 'day',
    atBase: false,
    baseKnown: true
  }
  assert.equal(candidateIntents(state).some(item => item.id === 'wait'), false)

  state.waitReason = 'furnace_processing'
  assert.equal(candidateIntents(state).some(item => item.id === 'wait'), true)
})

test('unarmed exploration exposes preparation as a strategic choice', () => {
  const state = byId('prepare_before_explore').initialState
  assert.deepEqual(
    candidateIntents(state).map(item => item.id),
    ['prepare_combat', 'continue_objective']
  )
})

test('repeated failures expose replan before stop', () => {
  const state = byId('repeated_failure_replan').initialState
  assert.deepEqual(
    candidateIntents(state).map(item => item.id),
    ['replan_route', 'stop_task']
  )
})

test('deterministic player policy completes every V2 scenario safely', async () => {
  const runs = []
  for (const scenario of scenarios) {
    runs.push(await runScenario(
      scenario,
      async (state, candidates) => ({
        choice: deterministicPlayerPolicy(state, candidates),
        source: 'rules',
        latency_ms: 0
      }),
      { policyName: 'rules' }
    ))
  }

  const failed = runs.filter(run => !run.success)
  assert.deepEqual(
    failed.map(run => ({
      id: run.id,
      trace: run.trace.map(step => step.choice),
      finalState: run.finalState
    })),
    []
  )

  const summary = summarizeRuns(runs)
  assert.equal(summary.success_rate, 1)
  assert.equal(summary.safety_violations, 0)
  assert.equal(summary.loop_rate, 0)
  assert.equal(summary.invalid_choices, 0)
})

test('interrupted objective resumes after the safety reaction', async () => {
  const scenario = byId('resume_after_creeper_interrupt')
  const run = await runScenario(
    scenario,
    async (state, candidates) => ({
      choice: deterministicPlayerPolicy(state, candidates),
      source: 'rules',
      latency_ms: 0
    }),
    { policyName: 'rules' }
  )

  assert.equal(run.success, true)
  assert.deepEqual(
    run.trace.map(step => step.choice),
    ['continue_objective', 'escape_danger', 'continue_objective']
  )
  assert.equal(run.finalState.resumedAfterInterrupt, true)
  assert.equal(run.finalState.objective.completed, true)
})
