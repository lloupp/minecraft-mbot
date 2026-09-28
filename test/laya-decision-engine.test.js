const test = require('node:test')
const assert = require('node:assert/strict')
const {
  LayaDecisionEngine,
  normalizeThreshold
} = require('../lib/decision-engine')

function layaEnv(t) {
  const before = process.env.MBOT_DECISION_ENGINE
  process.env.MBOT_DECISION_ENGINE = 'laya'
  t.after(() => {
    if (before == null) delete process.env.MBOT_DECISION_ENGINE
    else process.env.MBOT_DECISION_ENGINE = before
  })
}

test('laya accepts a trusted available action without a default threshold', async t => {
  layaEnv(t)
  const engine = new LayaDecisionEngine({
    endpoint: 'http://local/decision',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        action: 'fight',
        confidence: 0.42,
        trusted: true,
        probabilities: { fight: 0.42, move: 0.40, wait: 0.18 }
      })
    })
  })

  const result = await engine.decide({
    availableActions: ['fight', 'move', 'wait']
  }, { action: 'move' })

  assert.equal(result.source, 'laya')
  assert.equal(result.action, 'fight')
  assert.equal(result.confidence, 0.42)
  assert.deepEqual(result.probabilities, {
    fight: 0.42,
    move: 0.40,
    wait: 0.18
  })
})

test('laya rejects an action outside the dynamic mask', async t => {
  layaEnv(t)
  const engine = new LayaDecisionEngine({
    endpoint: 'http://local/decision',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        action: 'fight',
        confidence: 0.99,
        trusted: true
      })
    })
  })

  const result = await engine.decide({
    availableActions: ['move', 'wait']
  }, { action: 'move' })

  assert.equal(result.source, 'deterministic')
  assert.equal(result.reason, 'unavailable_action')
  assert.equal(result.action, 'move')
})

test('optional laya threshold is honored only when configured', async t => {
  layaEnv(t)
  const engine = new LayaDecisionEngine({
    endpoint: 'http://local/decision',
    threshold: 0.7,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        action: 'gather',
        confidence: 0.69,
        trusted: true
      })
    })
  })

  const result = await engine.decide({
    availableActions: ['gather', 'wait']
  }, { action: 'wait' })

  assert.equal(result.reason, 'low_confidence')
  assert.equal(result.action, 'wait')
})

test('normalizeThreshold keeps blank laya threshold disabled', () => {
  assert.equal(normalizeThreshold('', null), null)
  assert.equal(normalizeThreshold(undefined, null), null)
  assert.equal(normalizeThreshold('0.75', null), 0.75)
})
