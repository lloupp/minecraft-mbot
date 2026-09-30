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
  assert.ok(report.promotion_readiness.reasons.includes('fewer_than_2_active_hours'))
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

test('ordens independentes repetidas não contam como loop do agente', () => {
  const report = buildReport([row(), row(), row()])
  assert.equal(report.summary.loops, 0)
  assert.equal(report.summary.repeated_order_streaks, 1)
})

test('3 decisões idênticas na mesma linhagem contam como loop', () => {
  const sameLineage = { taskLineageId: 'w:7' }
  assert.equal(buildReport([
    row(sameLineage),
    row({ ...sameLineage, decidedAt: '2026-01-01T00:00:01.000Z' }),
    row({ ...sameLineage, decidedAt: '2026-01-01T00:00:02.000Z' })
  ]).summary.loops, 1)
  assert.equal(buildReport([
    row(sameLineage),
    row({ ...sameLineage, juliaChoice: 'b' }),
    row(sameLineage)
  ]).summary.loops, 0)
})

test('horas ativas ignoram pausas longas entre decisões', () => {
  const at = (iso) => row({ decidedAt: iso, juliaChoice: iso })
  const report = buildReport([
    at('2026-01-01T00:00:00.000Z'), at('2026-01-01T00:05:00.000Z'),
    at('2026-01-01T05:00:00.000Z'), at('2026-01-01T05:05:00.000Z') // 5 h de pausa
  ])
  assert.equal(report.summary.hours > 4, true)
  assert.equal(report.summary.active_hours, Number((10 / 60).toFixed(3)))
})

test('sequência relaxada por linhagem aparece como diagnóstico sem virar loop', () => {
  const same = (food) => row({ taskLineageId: 'w:1', state: { threat: null, food, objective: { type: 'explore' } } })
  const report = buildReport([same(20), same(19), same(18), same(17)])
  assert.equal(report.summary.loops, 0) // chave estrita muda com a fome
  assert.equal(report.summary.max_lineage_identical_streak, 4)
})
