const test = require('node:test')
const assert = require('node:assert/strict')
const { DecisionEngine, minecraftState } = require('../lib/decision-engine')

function enabledEnv(t) {
  const before = process.env.MBOT_DECISION_ENGINE
  process.env.MBOT_DECISION_ENGINE = 'conversa-llm'
  t.after(() => {
    if (before == null) delete process.env.MBOT_DECISION_ENGINE
    else process.env.MBOT_DECISION_ENGINE = before
  })
}

test('uses trusted allowlisted decision', async t => {
  enabledEnv(t)
  const engine = new DecisionEngine({
    endpoint: 'http://local/decision',
    fetchImpl: async () => ({ ok: true, json: async () => ({ action: 'craft', confidence: 0.91, trusted: true }) })
  })
  const result = await engine.decide({ objective: 'pickaxe' }, { action: 'wait' })
  assert.equal(result.source, 'conversa-llm')
  assert.equal(result.action, 'craft')
})

test('rejects unknown action and falls back', async t => {
  enabledEnv(t)
  const engine = new DecisionEngine({
    endpoint: 'http://local/decision',
    fetchImpl: async () => ({ ok: true, json: async () => ({ action: 'bash', confidence: 0.99, trusted: true }) })
  })
  const result = await engine.decide({}, { action: 'wait' })
  assert.equal(result.source, 'deterministic')
  assert.equal(result.reason, 'invalid_action')
})

test('low confidence falls back', async t => {
  enabledEnv(t)
  const engine = new DecisionEngine({
    endpoint: 'http://local/decision',
    threshold: 0.7,
    fetchImpl: async () => ({ ok: true, json: async () => ({ action: 'gather', confidence: 0.69, trusted: true }) })
  })
  const result = await engine.decide({}, { action: 'wait' })
  assert.equal(result.reason, 'low_confidence')
})

test('disabled engine never calls remote', async () => {
  const before = process.env.MBOT_DECISION_ENGINE
  delete process.env.MBOT_DECISION_ENGINE
  let called = false
  const engine = new DecisionEngine({ endpoint: 'http://local', fetchImpl: async () => { called = true } })
  const result = await engine.decide({}, { action: 'wait' })
  assert.equal(called, false)
  assert.equal(result.reason, 'disabled')
  if (before != null) process.env.MBOT_DECISION_ENGINE = before
})

test('serializes minimal Minecraft state', () => {
  const state = minecraftState({
    health: 20, food: 9,
    entity: { position: { x: 1.8, y: 64, z: -2.2 } },
    inventory: { items: () => [{ name: 'oak_log', count: 6 }, { name: 'oak_log', count: 2 }] }
  }, 'craft stone_pickaxe')
  assert.deepEqual(state.inventory, { oak_log: 8 })
  assert.deepEqual(state.position, { x: 1, y: 64, z: -3 })
  assert.equal(state.food, 9)
})


test('sends dynamic available-actions mask to remote model', async t => {
  enabledEnv(t)
  let body
  const engine = new DecisionEngine({
    endpoint: 'http://local/decision',
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body)
      return { ok: true, json: async () => ({ action: 'gather', confidence: 0.9, trusted: true }) }
    }
  })
  await engine.decide({ objective: 'wood', availableActions: ['gather', 'wait', 'bash'] }, { action: 'wait' })
  assert.deepEqual(body.available_actions, ['gather', 'wait'])
})
