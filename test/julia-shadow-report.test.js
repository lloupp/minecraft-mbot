const test = require('node:test')
const assert = require('node:assert/strict')
const { buildReport, percentile } = require('../scripts/julia-shadow-report')

const row = (extra = {}) => ({
  type: 'julia_shadow_decision', worker: 'w', decidedAt: '2026-01-01T00:00:00.000Z',
  state: { threat: null, food: 20, objective: { type: 'explore' } }, candidates: ['a', 'b'],
  juliaChoice: 'a', latencyMs: 100, agreesWithRules: true, executionAuthority: 'none', ...extra
})

test('percentile ignora valores não numéricos', () => {
  assert.equal(percentile([null, 100, 300, 200], 0.5), 200)
  assert.equal(percentile([], 0.95), null)
})

test('nunca declara prontidão com poucos dados, mas conta métricas corretamente', () => {
  const report = buildReport([
    row(), row({ decidedAt: '2026-01-01T00:00:01.000Z', latencyMs: 300, state: { food: 9 } }),
    row({ juliaChoice: null, juliaError: 'timeout', latencyMs: 4000 }),
    { type: 'julia_shadow_skip', reason: 'breaker_open' }
  ])
  assert.equal(report.summary.decisions, 3)
  assert.equal(report.summary.timeouts, 1)
  assert.equal(report.summary.skipped, 1)
  assert.equal(report.summary.availability, 2 / 4)
  assert.equal(report.promotion_readiness.ready_for_limited_authority, false)
  assert.ok(report.promotion_readiness.reasons.includes('fewer_than_500_decisions'))
})

test('escolha fora da máscara, abandono injustificado e autoridade != none bloqueiam', () => {
  const report = buildReport([
    row({ juliaChoice: 'x' }),
    row({ juliaChoice: 'stop_task', candidates: ['stop_task', 'a'], wouldAbandonObjective: true, unjustifiedAbandon: true }),
    row({ executionAuthority: 'full', wouldViolateSafety: true })
  ])
  const { reasons } = report.promotion_readiness
  for (const reason of ['choices_outside_allowlist', 'unjustified_abandonments', 'safety_violations', 'execution_authority_not_none']) {
    assert.ok(reasons.includes(reason), reason)
  }
})

test('3 decisões idênticas seguidas do mesmo worker contam como loop', () => {
  assert.equal(buildReport([row(), row(), row()]).summary.loops, 1)
  assert.equal(buildReport([row(), row(), row({ juliaChoice: 'b' })]).summary.loops, 0)
})
