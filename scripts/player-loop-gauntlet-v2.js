'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const {
  deterministicPlayerPolicy, runScenario, summarizeRuns
} = require('../lib/player-loop')

const scenarios = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/player-loop-gauntlet-v2.json'), 'utf8'))
const REPEATS = Math.max(1, Math.min(100, Number(process.env.PLAYER_LOOP_REPEATS || 5)))
const TIMEOUT_MS = Number(process.env.PLAYER_LOOP_TIMEOUT_MS || 4000)
const MODEL_ENGINES = ['laya', 'julia', 'andy', 'nanoandy']

function endpoint(env, fallback) { return process.env[env] || fallback }
function compactState(s) {
  return {
    health: s.health, food: s.food, time: s.time,
    threat: s.threat || null, inventory: s.inventory || {},
    equippedWeapon: s.equippedWeapon || null, equippedTool: s.equippedTool || null,
    tools: { weapon: s.equippedWeapon || null, tool: s.equippedTool || null },
    nearby: s.nearby || {}, craftable: s.craftable || [],
    base: { known: Boolean(s.baseKnown), atBase: Boolean(s.atBase), storage: s.baseStorage || {} },
    inventoryLoad: s.inventoryLoad || 0, objective: s.objective || null,
    progress: s.objective?.progress || 0, lastAction: s.lastIntent || null,
    lastResult: s.lastResult || null,
    recentFailures: s.recentFailures || [], consecutiveFailures: s.consecutiveFailures || 0,
    alternativeRoute: Boolean(s.alternativeRoute), waitReason: s.waitReason || null,
    resumePending: Boolean(s.resumePending), cancellationRequested: Boolean(s.cancellationRequested),
    fire: Boolean(s.onFire || s.fire), drowning: Boolean(s.drowning || s.inWater && s.air <= 0)
  }
}

async function remoteChoice(url, engine, state, candidates) {
  if (!url) return { error: 'endpoint_not_configured', source: `${engine}_error` }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const started = performance.now()
  try {
    const response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: compactState(state), candidates }), signal: controller.signal
    })
    const latency_ms = performance.now() - started
    if (response.status === 422) return {
      source: engine, choice: '__invalid_model_output__',
      error: 'invalid_model_output', latency_ms
    }
    if (!response.ok) return { source: `${engine}_error`, error: `http_${response.status}`, latency_ms }
    const value = await response.json()
    return { ...value, source: engine, latency_ms }
  } catch (error) {
    return { source: `${engine}_error`, error: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error), latency_ms: performance.now() - started }
  } finally { clearTimeout(timer) }
}

function fallback(state, candidates, result, engine) {
  if (!result?.choice) return {
    choice: deterministicPlayerPolicy(state, candidates),
    source: `${engine}_fallback:${result?.error || 'invalid_response'}`,
    latency_ms: Number(result?.latency_ms || 0)
  }
  return result
}

const CRITICAL = new Set(['hunger_with_food', 'creeper_critical', 'zombie_armed', 'zombie_unarmed_with_space', 'explicit_cancel'])
function readiness(runs, summary) {
  if (!runs.length) return { ready: false, reasons: ['model_not_run'], critical_failures: [] }
  const failedCritical = runs.filter(r => CRITICAL.has(r.id) && !r.success).map(r => r.id)
  const reasons = []
  if (!summary || summary.success_rate < 0.8) reasons.push('success_rate_below_80_percent')
  if (summary?.safety_violations) reasons.push('safety_violations')
  if (summary?.loop_rate) reasons.push('loops_detected')
  if (summary?.invalid_choices) reasons.push('invalid_choices')
  if (summary?.technical_fallbacks) reasons.push('technical_fallbacks')
  if (failedCritical.length) reasons.push('critical_scenarios_failed')
  if (summary?.p95_ms == null || summary.p95_ms > 2000) reasons.push('p95_latency_above_2s_or_unmeasured')
  return { ready: reasons.length === 0, reasons, critical_failures: failedCritical }
}

async function runPolicy(scenario, engine, choose) {
  const started = performance.now()
  const run = await runScenario(scenario, choose, { policyName: engine })
  run.scenario_time_ms = performance.now() - started
  return run
}

async function run() {
  const urls = {
    laya: endpoint('LAYA_PLAYER_LOOP_URL', process.env.LAYA_DECISION_URL?.replace(/\/decision\/?$/, '/choose')),
    julia: endpoint('JULIA_PLAYER_LOOP_URL', process.env.JULIA_DECISION_URL?.replace(/\/decision\/?$/, '/choose')),
    andy: endpoint('ANDY_PLAYER_LOOP_URL', null),
    nanoandy: endpoint('NANOANDY_PLAYER_LOOP_URL', null)
  }
  const results = { rules: [], laya: [], julia: [], andy: [], nanoandy: [] }
  for (let repeat = 0; repeat < REPEATS; repeat++) {
    for (const scenario of scenarios) {
      results.rules.push(await runPolicy(scenario, 'rules', async (state, candidates) => ({
        choice: deterministicPlayerPolicy(state, candidates), source: 'rules', latency_ms: 0
      })))
      for (const engine of MODEL_ENGINES) {
        if (!urls[engine]) continue
        results[engine].push(await runPolicy(scenario, engine, async (state, candidates) => {
          const response = await remoteChoice(urls[engine], engine, state, candidates)
          return fallback(state, candidates, response, engine)
        }))
      }
    }
  }
  const summary = Object.fromEntries(Object.entries(results).map(([name, runs]) => [name, summarizeRuns(runs)]))
  const perScenario = Object.fromEntries(scenarios.map(s => [s.id, Object.fromEntries(
    Object.entries(results).map(([engine, runs]) => {
      const matching = runs.filter(run => run.id === s.id)
      return [engine, { repeats: matching.length, success_rate: matching.filter(r => r.success).length / matching.length,
        safety_violations: matching.reduce((n, r) => n + r.safetyViolations, 0),
        loops: matching.filter(r => r.loopDetected).length,
        invalid_choices: matching.reduce((n, r) => n + r.invalidChoices, 0),
        model_calls: matching.reduce((n, r) => n + r.modelCalls, 0),
        model_requests: matching.reduce((n, r) => n + r.modelRequests, 0),
        fallbacks: matching.flatMap(r => r.trace).filter(t => t.source.includes('_fallback')).length,
        invalid_choice_fallbacks: matching.flatMap(r => r.trace).filter(t => t.source === 'invalid_fallback').length,
        objective_resumptions: matching.filter(r => r.finalState.resumedAfterInterrupt).length,
        p50_ms: summarizeRuns(matching).p50_ms, p95_ms: summarizeRuns(matching).p95_ms,
        median_scenario_ms: percentile(matching.map(r => r.scenario_time_ms), .5) }]
    })
  )]))
  const latencies = Object.fromEntries(Object.entries(results).map(([engine, runs]) => [engine, {
    p50_ms: summary[engine].p50_ms, p95_ms: summary[engine].p95_ms,
    median_scenario_ms: percentile(runs.map(r => r.scenario_time_ms), .5)
  }]))
  const report = {
    schemaVersion: 2, design: 'player_loop_v2_paired_comparison', repeats: REPEATS,
    sameScenarioOrder: true, modelExecutionAuthority: false,
    stateContract: Object.keys(compactState({})),
    endpoints: Object.fromEntries(MODEL_ENGINES.map(engine => [engine, urls[engine] || null])),
    summary, perScenario,
    shadow_readiness: Object.fromEntries(MODEL_ENGINES.map(engine => [engine, readiness(results[engine], summary[engine])])),
    note: 'No winner is selected by agreement with rules; outcomes, safety, invalid choices, fallback and latency are reported separately.',
    runs: results
  }
  const json = JSON.stringify(report, null, 2)
  if (process.env.MBOT_PLAYER_LOOP_OUT) {
    const target = path.resolve(process.env.MBOT_PLAYER_LOOP_OUT)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, `${json}\n`, 'utf8')
  }
  console.log(json)
  if (summary.rules.success_rate !== 1 || summary.rules.safety_violations || summary.rules.loop_rate || summary.rules.invalid_choices) {
    throw new Error('player-loop deterministic baseline failed its own scenarios')
  }
}

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return null
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]
}
run().catch(error => { console.error(error); process.exitCode = 1 })
