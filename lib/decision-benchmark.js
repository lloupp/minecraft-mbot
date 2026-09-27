'use strict'

const ACTIONS = ['gather', 'craft', 'smelt', 'eat', 'move', 'deposit', 'withdraw', 'build', 'fight', 'wait', 'stop']

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[index]
}

function brier(records) {
  const usable = records.filter(r => r.probabilities && ACTIONS.some(a => Number.isFinite(r.probabilities[a])))
  if (!usable.length) return null
  return usable.reduce((sum, row) => {
    const score = ACTIONS.reduce((s, action) => {
      const p = Number(row.probabilities[action] || 0)
      const y = action === row.expected ? 1 : 0
      return s + (p - y) ** 2
    }, 0)
    return sum + score
  }, 0) / usable.length
}

function ece(records, bins = 10) {
  const usable = records.filter(r => Number.isFinite(r.confidence))
  if (!usable.length) return null
  let total = 0
  for (let bin = 0; bin < bins; bin++) {
    const low = bin / bins
    const high = (bin + 1) / bins
    const rows = usable.filter(r => r.confidence >= low && (bin === bins - 1 ? r.confidence <= high : r.confidence < high))
    if (!rows.length) continue
    const avgConf = rows.reduce((s, r) => s + r.confidence, 0) / rows.length
    const acc = rows.filter(r => r.action === r.expected).length / rows.length
    total += (rows.length / usable.length) * Math.abs(acc - avgConf)
  }
  return total
}

function summarize(records) {
  if (!records?.length) {
    return {
      available: false, accuracy: null, invalid_rate: null, fallback_rate: null,
      brier: null, ece: null, p50_ms: null, p95_ms: null, order_sensitivity: null
    }
  }
  const invalid = records.filter(r => r.invalid).length
  const stableRows = records.filter(r => typeof r.stable === 'boolean')
  return {
    available: true,
    accuracy: records.filter(r => r.action === r.expected).length / records.length,
    invalid_rate: invalid / records.length,
    fallback_rate: records.filter(r => r.fallback).length / records.length,
    brier: brier(records),
    ece: ece(records),
    p50_ms: percentile(records.map(r => r.latency_ms), 0.50),
    p95_ms: percentile(records.map(r => r.latency_ms), 0.95),
    order_sensitivity: stableRows.length
      ? stableRows.filter(r => r.stable === false).length / stableRows.length
      : null
  }
}

function deterministicDecision(state, available = ACTIONS) {
  const has = action => available.includes(action)
  if (state.cancellationRequested && has('stop')) return 'stop'
  if (state.alreadyComplete && has('wait')) return 'wait'
  if (state.busy && has('wait')) return 'wait'
  if (Number(state.food) <= 7 && has('eat')) return 'eat'
  const threat = state.threats?.[0]
  if (threat) {
    if (threat.name === 'creeper' && has('move')) return 'move'
    if (Number(state.health) <= 7 && has('move')) return 'move'
    if (has('fight')) return 'fight'
  }
  if (Number(state.consecutiveFailures) >= 3) {
    if (state.alternativeRoute && has('move')) return 'move'
    if (has('stop')) return 'stop'
  }
  const type = state.objective?.type
  if (type && has(type)) return type
  if (type === 'move_to' && has('move')) return 'move'
  return has('wait') ? 'wait' : available[0]
}

function disagreement(a = [], b = []) {
  const byId = new Map(b.map(r => [r.id, r]))
  const paired = a.filter(r => byId.has(r.id))
  if (!paired.length) return null
  return paired.filter(r => byId.get(r.id).action !== r.action).length / paired.length
}

module.exports = { ACTIONS, percentile, brier, ece, summarize, deterministicDecision, disagreement }
