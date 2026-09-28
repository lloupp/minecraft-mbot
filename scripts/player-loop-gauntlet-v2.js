'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const {
  deterministicPlayerPolicy,
  runScenario,
  summarizeRuns
} = require('../lib/player-loop')

const scenarios = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../data/player-loop-gauntlet-v2.json'),
  'utf8'
))

function choiceUrl() {
  if (process.env.LAYA_PLAYER_LOOP_URL) return process.env.LAYA_PLAYER_LOOP_URL
  if (process.env.LAYA_DECISION_URL) {
    return process.env.LAYA_DECISION_URL.replace(/\/decision\/?$/, '/choose')
  }
  return null
}

async function remoteChoice(url, state, candidates, timeoutMs = 4000) {
  if (!url) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = performance.now()

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state, candidates }),
      signal: controller.signal
    })
    const latency_ms = performance.now() - started

    if (!response.ok) {
      return {
        source: 'laya_error',
        error: `http_${response.status}`,
        latency_ms
      }
    }

    const value = await response.json()
    return {
      ...value,
      source: 'laya',
      latency_ms
    }
  } catch (error) {
    return {
      source: 'laya_error',
      error: error?.name === 'AbortError'
        ? 'timeout'
        : String(error?.message || error),
      latency_ms: performance.now() - started
    }
  } finally {
    clearTimeout(timer)
  }
}

function compactState(state) {
  return {
    health: state.health,
    food: state.food,
    threat: state.threat || null,
    inventory: state.inventory || {},
    equippedWeapon: state.equippedWeapon || null,
    equippedTool: state.equippedTool || null,
    craftable: state.craftable || [],
    inventoryLoad: state.inventoryLoad || 0,
    objective: state.objective || null,
    time: state.time || null,
    atBase: Boolean(state.atBase),
    baseKnown: Boolean(state.baseKnown),
    baseStorage: state.baseStorage || null,
    nearby: state.nearby || null,
    consecutiveFailures: Number(state.consecutiveFailures || 0),
    alternativeRoute: Boolean(state.alternativeRoute),
    waitReason: state.waitReason || null,
    resumePending: Boolean(state.resumePending),
    lastIntent: state.lastIntent || null,
    lastResult: state.lastResult || null
  }
}

async function run() {
  const url = choiceUrl()
  const rules = []
  const laya = []

  for (const scenario of scenarios) {
    rules.push(await runScenario(
      scenario,
      async (state, candidates) => ({
        choice: deterministicPlayerPolicy(state, candidates),
        source: 'rules',
        latency_ms: 0
      }),
      { policyName: 'rules' }
    ))

    if (url) {
      const result = await runScenario(
        scenario,
        async (state, candidates) => {
          const response = await remoteChoice(
            url,
            compactState(state),
            candidates,
            Number(process.env.LAYA_DECISION_TIMEOUT_MS || 4000)
          )
          if (!response?.choice) {
            return {
              choice: deterministicPlayerPolicy(state, candidates),
              source: response?.error ? `laya_fallback:${response.error}` : 'laya_fallback',
              latency_ms: Number(response?.latency_ms || 0)
            }
          }
          return response
        },
        { policyName: 'laya' }
      )
      laya.push(result)
    }
  }

  const output = {
    schemaVersion: 1,
    design: 'player_loop_v2',
    principles: {
      event_driven: true,
      emergency_rules_outside_model: true,
      neutral_choice_keys: true,
      wait_requires_reason: true,
      deterministic_execution: true,
      outcome_based_evaluation: true
    },
    scenarios: scenarios.length,
    endpoint: url,
    summary: {
      rules: summarizeRuns(rules),
      laya: laya.length ? summarizeRuns(laya) : null
    },
    runs: { rules, laya }
  }

  const json = JSON.stringify(output, null, 2)
  const out = process.env.MBOT_PLAYER_LOOP_OUT
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
