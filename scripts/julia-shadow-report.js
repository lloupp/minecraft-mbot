'use strict'

// Lê o log do shadow mode da Julia-1 (lib/julia-shadow.js) e calcula métricas e
// critérios de prontidão para autoridade limitada. Só analisa dados já
// coletados; não liga a Julia a nada.
//
//   node scripts/julia-shadow-report.js [log.jsonl]
//   JULIA_SHADOW_LOG=... MBOT_SHADOW_REPORT_OUT=out.json node scripts/julia-shadow-report.js

const fs = require('node:fs')
const path = require('node:path')

const LOG_FILE = process.argv[2] || process.env.JULIA_SHADOW_LOG || '.data/julia-shadow.jsonl'
const MIN_DECISIONS = 500
const MIN_HOURS = 2
const MIN_AVAILABILITY = 0.98
const MAX_P95_MS = 2000

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return null
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]
}

function readRows(file) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)] } catch { return [] }
  })
}

function count(rows, fn) { return rows.filter(fn).length }

function buildReport(all) {
  const decisions = all.filter((r) => r.type === 'julia_shadow_decision')
  const skips = all.filter((r) => r.type === 'julia_shadow_skip')
  const answered = decisions.filter((r) => r.juliaChoice)
  const latencies = decisions.map((r) => r.latencyMs)
  const times = decisions.map((r) => Date.parse(r.decidedAt)).filter(Number.isFinite)
  const hours = times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 3.6e6 : 0

  // Loop: mesma escolha sobre o mesmo estado 3+ vezes seguidas para o mesmo worker.
  let loops = 0
  const streak = new Map()
  for (const r of decisions) {
    const key = JSON.stringify([r.juliaChoice, r.state?.threat, r.state?.food, r.state?.objective, r.candidates])
    const cur = streak.get(r.worker)
    if (cur && cur.key === key) { cur.n++; if (cur.n === 3) loops++ } else streak.set(r.worker, { key, n: 1 })
  }

  const errors = decisions.filter((r) => r.juliaError)
  const summary = {
    decisions: decisions.length,
    skipped: skips.length,
    answered: answered.length,
    hours: Number(hours.toFixed(3)),
    availability: decisions.length + skips.length ? answered.length / (decisions.length + skips.length) : null,
    latency_ms: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), max: percentile(latencies, 1) },
    errors: Object.fromEntries([...new Set(errors.map((r) => r.juliaError))].map((e) => [e, count(errors, (r) => r.juliaError === e)])),
    invalid_choices: count(decisions, (r) => r.juliaError === 'invalid_choice'),
    timeouts: count(decisions, (r) => r.juliaError === 'timeout'),
    agrees_with_rules: count(answered, (r) => r.agreesWithRules === true),
    disagrees_with_rules: count(answered, (r) => r.agreesWithRules === false),
    agrees_with_real: count(answered, (r) => r.agreesWithReal === true),
    disagrees_with_real: count(answered, (r) => r.agreesWithReal === false),
    safety_critical_decisions: count(decisions, (r) => r.safetyCritical),
    safety_overrides: count(decisions, (r) => r.safetyOverride),
    safety_violations: count(answered, (r) => r.wouldViolateSafety === true),
    abandonments: count(answered, (r) => r.wouldAbandonObjective),
    unjustified_abandonments: count(answered, (r) => r.unjustifiedAbandon),
    loops,
    interrupted: count(decisions, (r) => r.interrupted === true),
    resumed: count(decisions, (r) => r.resumedObjective === true),
    real_action_failed: count(decisions, (r) => r.result && r.result.ok === false),
    outside_allowlist: count(decisions, (r) => r.juliaChoice && !(r.candidates || []).includes(r.juliaChoice)),
    execution_authority: [...new Set(decisions.map((r) => r.executionAuthority))]
  }

  const reasons = []
  if (summary.decisions < MIN_DECISIONS) reasons.push(`fewer_than_${MIN_DECISIONS}_decisions`)
  if (summary.hours < MIN_HOURS) reasons.push(`fewer_than_${MIN_HOURS}_hours`)
  if (summary.safety_violations) reasons.push('safety_violations')
  if (summary.outside_allowlist || summary.invalid_choices) reasons.push('choices_outside_allowlist')
  if (summary.unjustified_abandonments) reasons.push('unjustified_abandonments')
  if (summary.loops) reasons.push('loops')
  if (summary.latency_ms.p95 == null || summary.latency_ms.p95 >= MAX_P95_MS) reasons.push('p95_latency_not_below_2s')
  if (summary.availability == null || summary.availability < MIN_AVAILABILITY) reasons.push('availability_below_98_percent')
  if (summary.execution_authority.some((v) => v !== 'none')) reasons.push('execution_authority_not_none')

  return { log: LOG_FILE, summary, promotion_readiness: { ready_for_limited_authority: reasons.length === 0, reasons } }
}

if (require.main === module) {
  const report = buildReport(readRows(LOG_FILE))
  const json = JSON.stringify(report, null, 2)
  if (process.env.MBOT_SHADOW_REPORT_OUT) {
    const target = path.resolve(process.env.MBOT_SHADOW_REPORT_OUT)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, `${json}\n`, 'utf8')
  }
  console.log(json)
}

module.exports = { buildReport, readRows, percentile }
