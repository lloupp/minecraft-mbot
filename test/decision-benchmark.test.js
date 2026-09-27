const test = require('node:test')
const assert = require('node:assert/strict')
const {
  percentile, brier, ece, summarize, deterministicDecision, disagreement
} = require('../lib/decision-benchmark')

test('deterministic baseline handles safety priorities', () => {
  assert.equal(deterministicDecision({ food: 5, objective: { type: 'gather' } }, ['eat', 'gather', 'wait']), 'eat')
  assert.equal(deterministicDecision({ health: 6, food: 20, threats: [{ name: 'zombie' }] }, ['fight', 'move', 'wait']), 'move')
  assert.equal(deterministicDecision({ health: 20, food: 20, threats: [{ name: 'creeper' }] }, ['fight', 'move', 'wait']), 'move')
  assert.equal(deterministicDecision({ food: 20, cancellationRequested: true }, ['stop', 'wait']), 'stop')
})

test('summary computes accuracy latency fallback and order sensitivity', () => {
  const records = [
    { expected: 'gather', action: 'gather', invalid: false, fallback: false, confidence: 0.9, probabilities: { gather: 0.9, wait: 0.1 }, latency_ms: 10, stable: true },
    { expected: 'wait', action: 'gather', invalid: false, fallback: true, confidence: 0.7, probabilities: { gather: 0.7, wait: 0.3 }, latency_ms: 30, stable: false }
  ]
  const result = summarize(records)
  assert.equal(result.available, true)
  assert.equal(result.accuracy, 0.5)
  assert.equal(result.fallback_rate, 0.5)
  assert.equal(result.p50_ms, 10)
  assert.equal(result.p95_ms, 30)
  assert.equal(result.order_sensitivity, 0.5)
  assert.ok(result.brier > 0)
  assert.ok(result.ece >= 0)
})

test('missing engine produces explicit null metrics', () => {
  assert.deepEqual(summarize([]), {
    available: false,
    accuracy: null,
    invalid_rate: null,
    fallback_rate: null,
    brier: null,
    ece: null,
    p50_ms: null,
    p95_ms: null,
    order_sensitivity: null
  })
})

test('metrics helpers are deterministic', () => {
  assert.equal(percentile([30, 10, 20], 0.5), 20)
  assert.equal(disagreement(
    [{ id: 'a', action: 'gather' }, { id: 'b', action: 'wait' }],
    [{ id: 'a', action: 'gather' }, { id: 'b', action: 'gather' }]
  ), 0.5)
  assert.equal(brier([]), null)
  assert.equal(ece([]), null)
})
