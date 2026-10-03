const test = require('node:test')
const assert = require('node:assert/strict')
const {
  LayaDecisionEngine,
  normalizeThreshold,
  normalizeTimeout
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

test('laya rejects any model action when dynamic mask is empty', async t => {
  layaEnv(t)
  const engine = new LayaDecisionEngine({
    endpoint: 'http://local/decision',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        action: 'wait',
        confidence: 1,
        trusted: true
      })
    })
  })

  const result = await engine.decide({
    availableActions: []
  }, { action: 'stop' })

  assert.equal(result.source, 'deterministic')
  assert.equal(result.reason, 'unavailable_action')
  assert.equal(result.action, 'stop')
})

test('laya requires trusted true explicitly', async t => {
  layaEnv(t)
  const engine = new LayaDecisionEngine({
    endpoint: 'http://local/decision',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        action: 'gather',
        confidence: 0.99
      })
    })
  })

  const result = await engine.decide({
    availableActions: ['gather', 'wait']
  }, { action: 'wait' })

  assert.equal(result.source, 'deterministic')
  assert.equal(result.reason, 'untrusted')
  assert.equal(result.action, 'wait')
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

test('normalizers keep blank threshold disabled and invalid timeout safe', () => {
  assert.equal(normalizeThreshold('', null), null)
  assert.equal(normalizeThreshold(undefined, null), null)
  assert.equal(normalizeThreshold('0.75', null), 0.75)
  assert.equal(normalizeTimeout('4000', 1500), 4000)
  assert.equal(normalizeTimeout('bad', 1500), 1500)
  assert.equal(normalizeTimeout(0, 1500), 1500)
})
