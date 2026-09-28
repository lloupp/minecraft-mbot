const test = require('node:test')
const assert = require('node:assert/strict')
const { buildReport, isUnsafeChoice, countLoops, isCriticalDecision } = require('../scripts/laya-shadow-report')

function decisionRow({
  decidedAt, worker = 'w1', state = {}, layaChoice = 'continue_objective', layaError = null, latencyMs = 900
} = {}) {
  return { type: 'laya_shadow_decision', worker, decidedAt, state, layaChoice, layaError, latencyMs }
}

test('isCriticalDecision exige uma ameaça (zumbi/creeper) ou saúde crítica com ameaça presente', () => {
  assert.equal(isCriticalDecision({ state: { threat: { type: 'zombie' } } }), true)
  assert.equal(isCriticalDecision({ state: { threat: { type: 'creeper' } } }), true)
  assert.equal(isCriticalDecision({ state: {} }), false)
  assert.equal(isCriticalDecision({ state: { health: 4 } }), false) // sem ameaça, não é "crítico" para este relatório
  assert.equal(isCriticalDecision({ state: { health: 4, threat: { type: 'skeleton' } } }), true)
})

test('isUnsafeChoice: ignorar ameaça continuando ou esperando é inseguro', () => {
  const state = { threat: { type: 'zombie', distance: 6 } }
  assert.equal(isUnsafeChoice(state, 'continue_objective'), true)
  assert.equal(isUnsafeChoice(state, 'wait'), true)
  assert.equal(isUnsafeChoice(state, 'escape_danger'), false)
})

test('isUnsafeChoice: lutar desarmado é inseguro; lutar armado não', () => {
  const state = { threat: { type: 'zombie', distance: 6 } }
  assert.equal(isUnsafeChoice(state, 'fight_threat'), true) // sem equippedWeapon
  assert.equal(isUnsafeChoice({ ...state, equippedWeapon: 'stone_sword' }, 'fight_threat'), false)
})

test('isUnsafeChoice: lutar contra creeper de perto é inseguro mesmo armado', () => {
  const state = { threat: { type: 'creeper', distance: 3 }, equippedWeapon: 'stone_sword' }
  assert.equal(isUnsafeChoice(state, 'fight_threat'), true)
})

test('isUnsafeChoice: sem ameaça, nenhuma escolha conta como insegura', () => {
  assert.equal(isUnsafeChoice({}, 'wait'), false)
  assert.equal(isUnsafeChoice({}, 'continue_objective'), false)
  assert.equal(isUnsafeChoice(null, 'fight_threat'), false)
})

test('countLoops detecta a mesma decisão se repetindo 3x seguidas para o mesmo worker', () => {
  const state = { health: 20, food: 20 }
  const rows = [
    decisionRow({ worker: 'a', state, layaChoice: 'wait' }),
    decisionRow({ worker: 'a', state, layaChoice: 'wait' }),
    decisionRow({ worker: 'a', state, layaChoice: 'wait' }),
    decisionRow({ worker: 'a', state, layaChoice: 'wait' }) // 4ª repetição não conta de novo
  ]
  assert.equal(countLoops(rows), 1)
})

test('countLoops não conta quando a escolha ou o estado muda entre decisões', () => {
  const rows = [
    decisionRow({ worker: 'a', state: { food: 20 }, layaChoice: 'wait' }),
    decisionRow({ worker: 'a', state: { food: 19 }, layaChoice: 'wait' }),
    decisionRow({ worker: 'a', state: { food: 18 }, layaChoice: 'gather_materials' })
  ]
  assert.equal(countLoops(rows), 0)
})

test('countLoops conta separadamente por worker', () => {
  const state = { health: 20 }
  const rows = [
    decisionRow({ worker: 'a', state, layaChoice: 'wait' }),
    decisionRow({ worker: 'a', state, layaChoice: 'wait' }),
    decisionRow({ worker: 'a', state, layaChoice: 'wait' }),
    decisionRow({ worker: 'b', state, layaChoice: 'wait' }),
    decisionRow({ worker: 'b', state, layaChoice: 'wait' }),
    decisionRow({ worker: 'b', state, layaChoice: 'wait' })
  ]
  assert.equal(countLoops(rows), 2)
})

test('buildReport: dataset insuficiente reprova em vários critérios ao mesmo tempo', () => {
  const rows = [
    decisionRow({ decidedAt: '2026-01-01T00:00:00.000Z' }),
    decisionRow({ decidedAt: '2026-01-01T00:01:00.000Z', layaError: 'invalid_choice' })
  ]
  const report = buildReport(rows)
  assert.equal(report.summary.decisions, 2)
  assert.equal(report.promotion_readiness.ready, false)
  assert.ok(report.promotion_readiness.reasons.includes('decisions_below_500'))
  assert.ok(report.promotion_readiness.reasons.includes('accumulated_hours_below_2'))
  assert.ok(report.promotion_readiness.reasons.includes('invalid_choices'))
})

test('buildReport: decisão insegura em cenário crítico aparece nas amostras e reprova o gate', () => {
  const rows = [
    decisionRow({
      decidedAt: '2026-01-01T00:00:00.000Z',
      state: { threat: { type: 'creeper', distance: 3 }, health: 6 },
      layaChoice: 'continue_objective'
    })
  ]
  const report = buildReport(rows)
  assert.equal(report.summary.criticalDecisions, 1)
  assert.equal(report.summary.criticalUnsafeDecisions, 1)
  assert.ok(report.promotion_readiness.reasons.includes('critical_unsafe_decisions'))
  assert.equal(report.criticalUnsafeSamples.length, 1)
  assert.equal(report.criticalUnsafeSamples[0].layaChoice, 'continue_objective')
})

test('buildReport: descartes (skip) entram na conta de disponibilidade', () => {
  const rows = [
    decisionRow({ decidedAt: '2026-01-01T00:00:00.000Z' }),
    { type: 'laya_shadow_skip', worker: 'w1', reason: 'breaker_open' }
  ]
  const report = buildReport(rows)
  assert.equal(report.summary.skips, 1)
  // 1 decisão disponível de 2 tentativas no total (1 decisão + 1 descarte)
  assert.equal(report.summary.availability, 0.5)
})

test('buildReport: dataset limpo e suficiente aprova o gate', () => {
  const base = new Date('2026-01-01T00:00:00.000Z').getTime()
  const rows = []
  for (let i = 0; i < 500; i++) {
    rows.push(decisionRow({
      decidedAt: new Date(base + i * 15000).toISOString(), // ~2h05 no total
      state: { health: 20, food: 20 },
      layaChoice: i % 2 === 0 ? 'continue_objective' : 'wait',
      latencyMs: 800 + (i % 50)
    }))
  }
  const report = buildReport(rows)
  assert.equal(report.summary.decisions, 500)
  assert.ok(report.summary.accumulatedHours >= 2)
  assert.equal(report.summary.availability, 1)
  assert.equal(report.summary.invalidChoices, 0)
  assert.equal(report.summary.criticalUnsafeDecisions, 0)
  assert.equal(report.summary.loopsAttributableToDecider, 0) // alterna 2 escolhas, nunca repete 3x seguidas
  assert.ok(report.summary.p95_ms <= 900)
  assert.deepEqual(report.promotion_readiness, { ready: true, reasons: [] })
})
