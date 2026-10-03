'use strict'

// Lê o log do shadow mode (lib/laya-shadow.js) e calcula os critérios
// mínimos definidos para considerar uma futura promoção do Laya (item 7 do
// pedido de shadow mode). Isto só analisa dados já coletados: não liga o
// Laya a nada, não decide nada, não é chamado pelo runtime.
//
//   node scripts/laya-shadow-report.js
//   LAYA_SHADOW_LOG=.data/laya-shadow.jsonl node scripts/laya-shadow-report.js
//   MBOT_SHADOW_REPORT_OUT=.data/laya-shadow-report.json node scripts/laya-shadow-report.js

const fs = require('node:fs')
const path = require('node:path')
const { EventLog } = require('../lib/event-log')
const { applyIntent, stateSignature } = require('../lib/player-loop')

const LOG_FILE = process.argv[2] || process.env.LAYA_SHADOW_LOG || '.data/laya-shadow.jsonl'
const MIN_DECISIONS = 500
const MIN_HOURS = 2
const MIN_AVAILABILITY = 0.98
const MAX_P95_MS = null // sem limite fixo pedido para o shadow; só é registrado

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[index]
}

// Mesma lógica de segurança já validada pelo Gauntlet V2 (lib/player-loop.js
// applyIntent): lutar desarmado, lutar creeper de perto, ou ignorar perigo
// continuando/esperando. Roda em cima do estado JÁ REGISTRADO, offline — não
// afeta nada em tempo real.
function isUnsafeChoice(state, choice) {
  if (!state || !choice) return false
  try {
    if (state.threat && (choice === 'continue_objective' || choice === 'wait')) return true
    const { result } = applyIntent(state, choice, {})
    return Boolean(result?.safetyViolation)
  } catch {
    return false // estado incompleto para simular: não vira falso positivo
  }
}

// Mesmo critério do runner do Gauntlet: a mesma dupla (estado, escolha) do
// mesmo worker se repetindo 3+ vezes seguidas é um loop atribuível ao decisor.
function countLoops(rows) {
  const byWorker = new Map()
  for (const row of rows) byWorker.set(row.worker, [...(byWorker.get(row.worker) || []), row])

  let loops = 0
  for (const workerRows of byWorker.values()) {
    let streakKey = null
    let streak = 0
    for (const row of workerRows) {
      const key = row.layaChoice ? `${stateSignature(row.state || {})}|${row.layaChoice}` : null
      if (key && key === streakKey) {
        streak++
        if (streak === 3) loops++ // conta o loop uma vez quando ele se confirma
      } else {
        streakKey = key
        streak = key ? 1 : 0
      }
    }
  }
  return loops
}

const CRITICAL_THREAT_TYPES = new Set(['creeper', 'zombie'])
function isCriticalDecision(row) {
  const threat = row.state?.threat
  return Boolean(threat) && (CRITICAL_THREAT_TYPES.has(threat.type) || Number(row.state?.health) <= 6)
}

// `rows` vem de EventLog.getEvents(): cada evento é {..payload, time, type,
// worker}, sem aninhamento — os campos do payload (state, layaChoice, etc.)
// estão soltos no objeto, junto com `time`/`type`/`worker` do próprio log.
function buildReport(rows) {
  const decisions = rows.filter((r) => r.type === 'laya_shadow_decision')
  const skips = rows.filter((r) => r.type === 'laya_shadow_skip')
  const total = decisions.length + skips.length

  const times = decisions.map((d) => new Date(d.decidedAt).getTime()).filter(Number.isFinite)
  const accumulatedHours = times.length >= 2 ? (Math.max(...times) - Math.min(...times)) / 3600000 : 0

  const available = decisions.filter((d) => !d.layaError).length
  const availability = total ? available / total : null

  const latencies = decisions.map((d) => d.latencyMs).filter(Number.isFinite)
  const invalidChoices = decisions.filter((d) => d.layaError === 'invalid_choice').length

  const criticalDecisions = decisions.filter(isCriticalDecision)
  const criticalUnsafe = criticalDecisions.filter((d) => isUnsafeChoice(d.state, d.layaChoice))

  const loops = countLoops(decisions)

  const summary = {
    decisions: decisions.length,
    skips: skips.length,
    accumulatedHours: Math.round(accumulatedHours * 100) / 100,
    availability: availability == null ? null : Math.round(availability * 10000) / 10000,
    invalidChoices,
    criticalDecisions: criticalDecisions.length,
    criticalUnsafeDecisions: criticalUnsafe.length,
    loopsAttributableToDecider: loops,
    p50_ms: percentile(latencies, 0.50),
    p95_ms: percentile(latencies, 0.95)
  }

  const reasons = []
  if (summary.decisions < MIN_DECISIONS) reasons.push(`decisions_below_${MIN_DECISIONS}`)
  if (summary.accumulatedHours < MIN_HOURS) reasons.push(`accumulated_hours_below_${MIN_HOURS}`)
  if (summary.criticalUnsafeDecisions !== 0) reasons.push('critical_unsafe_decisions')
  if (summary.invalidChoices !== 0) reasons.push('invalid_choices')
  if (summary.loopsAttributableToDecider !== 0) reasons.push('loops_attributable_to_decider')
  if (availability != null && availability < MIN_AVAILABILITY) reasons.push(`availability_below_${MIN_AVAILABILITY}`)
  if (MAX_P95_MS != null && summary.p95_ms != null && summary.p95_ms > MAX_P95_MS) reasons.push('p95_latency_too_high')

  return {
    schemaVersion: 1,
    logFile: path.resolve(LOG_FILE),
    thresholds: { minDecisions: MIN_DECISIONS, minHours: MIN_HOURS, minAvailability: MIN_AVAILABILITY },
    summary,
    promotion_readiness: { ready: reasons.length === 0, reasons },
    criticalUnsafeSamples: criticalUnsafe.slice(0, 10).map((d) => ({
      decidedAt: d.decidedAt, worker: d.worker, threat: d.state?.threat, layaChoice: d.layaChoice
    }))
  }
}

function main() {
  if (!fs.existsSync(LOG_FILE)) {
    console.error(`Log do shadow mode não encontrado: ${LOG_FILE} (shadow mode ainda não gerou decisões?)`)
    process.exitCode = 1
    return
  }
  const rows = new EventLog(LOG_FILE).getEvents()
  const report = buildReport(rows)

  const json = JSON.stringify(report, null, 2)
  const out = process.env.MBOT_SHADOW_REPORT_OUT
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
    fs.writeFileSync(path.resolve(out), json + '\n', 'utf8')
  }
  console.log(json)
}

if (require.main === module) main()

module.exports = { buildReport, isUnsafeChoice, countLoops, isCriticalDecision }
