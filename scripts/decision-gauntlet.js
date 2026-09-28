'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const {
  ACTIONS, summarize, deterministicDecision, disagreement
} = require('../lib/decision-benchmark')

const fixtures = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../data/decision-gauntlet.json'), 'utf8'
))

async function remoteDecision(url, fixture, timeoutMs = 3000) {
  if (!url) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = performance.now()

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        state: {
          ...fixture.state,
          availableActions: fixture.availableActions
        },
        available_actions: fixture.availableActions
      }),
      signal: controller.signal
    })
    const latency_ms = performance.now() - started

    if (!response.ok) return { error: `http_${response.status}`, latency_ms }

    const value = await response.json()
    return { ...value, latency_ms }
  } catch (error) {
    return {
      error: error?.name === 'AbortError'
        ? 'timeout'
        : String(error?.message || error),
      latency_ms: performance.now() - started
    }
  } finally {
    clearTimeout(timer)
  }
}

function baseRecord(fixture, action, extra = {}) {
  return {
    id: fixture.id,
    expected: fixture.expected,
    action,
    invalid: !fixture.availableActions.includes(action),
    fallback: false,
    confidence: null,
    probabilities: null,
    latency_ms: 0,
    stable: null,
    ...extra
  }
}

function appendRemoteRecord({
  fixture,
  result,
  target,
  fallbackTarget = null,
  rule
}) {
  if (!result) return

  const action = String(result.action || '')
  const invalid =
    !fixture.availableActions.includes(action) ||
    !ACTIONS.includes(action)

  target.push(baseRecord(fixture, action, {
    invalid,
    confidence: Number.isFinite(Number(result.confidence))
      ? Number(result.confidence)
      : null,
    probabilities: result.probabilities || null,
    latency_ms: Number(result.latency_ms) || 0
  }))

  if (fallbackTarget) {
    const trusted = result.trusted === true && !invalid
    fallbackTarget.push(baseRecord(
      fixture,
      trusted ? action : rule,
      {
        fallback: !trusted,
        confidence: trusted && Number.isFinite(Number(result.confidence))
          ? Number(result.confidence)
          : null,
        probabilities: trusted ? (result.probabilities || null) : null,
        latency_ms: Number(result.latency_ms) || 0
      }
    ))
  }
}

async function run() {
  const records = {
    rules: [],
    conversa: [],
    conversa_fallback: [],
    laya: [],
    laya_fallback: [],
    julia_shadow: [],
    julia_fallback_simulated: []
  }

  for (const fixture of fixtures) {
    const rule = deterministicDecision(
      fixture.state,
      fixture.availableActions
    )
    records.rules.push(baseRecord(fixture, rule))

    const conversa = await remoteDecision(
      process.env.CONVERSA_DECISION_URL,
      fixture
    )
    appendRemoteRecord({
      fixture,
      result: conversa,
      target: records.conversa,
      fallbackTarget: records.conversa_fallback,
      rule
    })

    const laya = await remoteDecision(
      process.env.LAYA_DECISION_URL,
      fixture,
      Number(process.env.LAYA_DECISION_TIMEOUT_MS || 4000)
    )
    appendRemoteRecord({
      fixture,
      result: laya,
      target: records.laya,
      fallbackTarget: records.laya_fallback,
      rule
    })

    const julia = await remoteDecision(
      process.env.JULIA_DECISION_URL,
      fixture
    )
    if (julia) {
      const action = String(julia.action || '')
      const invalid =
        !fixture.availableActions.includes(action) ||
        !ACTIONS.includes(action)
      const stable =
        typeof julia.stable === 'boolean'
          ? julia.stable
          : null

      records.julia_shadow.push(baseRecord(fixture, action, {
        invalid,
        confidence: Number.isFinite(Number(julia.confidence))
          ? Number(julia.confidence)
          : null,
        probabilities: julia.probabilities || null,
        latency_ms: Number(julia.latency_ms) || 0,
        stable
      }))

      const eligible =
        julia.eligible === true &&
        !invalid &&
        stable === true

      records.julia_fallback_simulated.push(baseRecord(
        fixture,
        eligible ? action : rule,
        {
          fallback: !eligible,
          confidence: eligible && Number.isFinite(Number(julia.confidence))
            ? Number(julia.confidence)
            : null,
          probabilities: eligible
            ? (julia.probabilities || null)
            : null,
          latency_ms: Number(julia.latency_ms) || 0,
          stable
        }
      ))
    }
  }

  const summary = Object.fromEntries(
    Object.entries(records)
      .map(([name, rows]) => [name, summarize(rows)])
  )

  const comparisons = {
    rules_vs_conversa: disagreement(records.rules, records.conversa),
    rules_vs_conversa_fallback:
      disagreement(records.rules, records.conversa_fallback),
    rules_vs_laya: disagreement(records.rules, records.laya),
    rules_vs_laya_fallback:
      disagreement(records.rules, records.laya_fallback),
    rules_vs_julia_shadow:
      disagreement(records.rules, records.julia_shadow),
    conversa_vs_laya:
      disagreement(records.conversa, records.laya),
    laya_vs_julia_shadow:
      disagreement(records.laya, records.julia_shadow)
  }

  const output = {
    schemaVersion: 2,
    fixtures: fixtures.length,
    endpoints: {
      conversa: Boolean(process.env.CONVERSA_DECISION_URL),
      laya: Boolean(process.env.LAYA_DECISION_URL),
      julia: Boolean(process.env.JULIA_DECISION_URL)
    },
    harness_rss_mb:
      Math.round(process.memoryUsage().rss / 1024 / 1024 * 100) / 100,
    summary,
    comparisons,
    records
  }

  const json = JSON.stringify(output, null, 2)
  const out = process.env.MBOT_GAUNTLET_OUT
  if (out) {
    const target = path.resolve(out)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, json + '\n', 'utf8')
  }
  console.log(json)
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
