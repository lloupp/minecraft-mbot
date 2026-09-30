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


test('unarmed exploration with nearby basic materials forces gather before progress', () => {
  const state = {
    health: 20,
    food: 20,
    inventory: {},
    craftable: [],
    equippedWeapon: null,
    nearby: { wood: true, stone: true, iron: false },
    objective: { type: 'explore', progress: 0, target: 1, completed: false },
    time: 'day',
    atBase: false,
    baseKnown: true
  }

  assert.deepEqual(
    candidateIntents(state).map(item => item.id),
    ['gather_materials']
  )
})

test('armed-tool mine_iron still gathers combat materials before unarmed progress', () => {
  const state = {
    health: 20,
    food: 20,
    inventory: { stone_pickaxe: 1 },
    craftable: [],
    equippedWeapon: null,
    equippedTool: 'stone_pickaxe',
    nearby: { wood: false, stone: true, iron: true },
    objective: { type: 'mine_iron', progress: 0, target: 1, completed: false },
    time: 'day',
    atBase: false,
    baseKnown: true
  }

  assert.deepEqual(
    candidateIntents(state).map(item => item.id),
    ['gather_materials']
  )
})

test('unarmed objective without nearby materials does not invent a gather target', () => {
  const state = {
    health: 20,
    food: 20,
    inventory: {},
    craftable: [],
    equippedWeapon: null,
    nearby: { wood: false, stone: false, iron: false },
    objective: { type: 'explore', progress: 0, target: 1, completed: false },
    time: 'day',
    atBase: false,
    baseKnown: true
  }

  assert.deepEqual(
    candidateIntents(state).map(item => item.id),
    ['continue_objective']
  )
})

test('repeated failures with a known alternative route expose only replan', () => {
  const state = byId('repeated_failure_replan').initialState
  assert.deepEqual(
    candidateIntents(state).map(item => item.id),
    ['replan_route']
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

test('adaptive gather scenario exposes threat after first exploration and resumes safely', async () => {
  const scenario = byId('gather_then_prepare_then_explore')
  const run = await runScenario(scenario, async (state, candidates) => ({
    choice: deterministicPlayerPolicy(state, candidates), source: 'rules'
  }), { policyName: 'rules' })
  assert.equal(run.success, true)
  assert.equal(run.finalState.health >= 8, true)
  assert.equal(run.finalState.resumedAfterInterrupt, true)
  assert.deepEqual(run.trace.map(step => step.choice), [
    'gather_materials', 'prepare_combat', 'continue_objective',
    'fight_threat', 'continue_objective'
  ])
})

test('fire and drowning are forced safety decisions outside model candidates', () => {
  for (const hazard of [{ onFire: true }, { drowning: true }]) {
    assert.deepEqual(candidateIntents({ health: 20, food: 18, ...hazard }).map(x => x.id), ['escape_danger'])
  }
})

test('report separates endpoint attempts, confirmed model calls, and invalid-choice fallbacks', async () => {
  const scenario = byId('prepare_before_explore')
  const transportFailure = await runScenario(scenario, async (_state, candidates) => ({
    choice: deterministicPlayerPolicy({}, candidates), source: 'nanoandy_fallback:timeout',
    model_calls: 0
  }), { policyName: 'nanoandy' })
  assert.equal(transportFailure.modelRequests, 1)
  assert.equal(transportFailure.modelCalls, 0)
  assert.equal(summarizeRuns([transportFailure]).technical_fallbacks, 1)

  const invalidOutput = await runScenario(scenario, async () => ({
    choice: '__invented__', source: 'nanoandy', model_calls: 1
  }), { policyName: 'nanoandy' })
  const invalidSummary = summarizeRuns([invalidOutput])
  assert.equal(invalidOutput.invalidChoices, 1)
  assert.equal(invalidOutput.modelCalls, 1)
  assert.equal(invalidSummary.invalid_choice_fallbacks, 1)
  assert.equal(invalidSummary.fallbacks, 1)
  assert.equal(invalidSummary.technical_fallbacks, 0)
})
