'use strict'

const FOOD_ITEMS = [
  'bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken',
  'baked_potato', 'carrot', 'apple'
]

const WEAPON_SCORE = {
  wooden_sword: 1,
  stone_sword: 2,
  stone_axe: 2,
  iron_sword: 3,
  iron_axe: 3,
  diamond_sword: 4,
  diamond_axe: 4,
  netherite_sword: 5,
  netherite_axe: 5
}

const PICKAXE_SCORE = {
  wooden_pickaxe: 1,
  stone_pickaxe: 2,
  iron_pickaxe: 3,
  diamond_pickaxe: 4,
  netherite_pickaxe: 5
}

const INTENT_DESCRIPTIONS = {
  escape_danger: 'Create distance from the immediate threat now. Survival takes priority over the current objective.',
  eat_now: 'Eat food already carried to restore hunger before continuing.',
  fight_threat: 'Fight the nearby hostile now using the currently equipped combat gear.',
  equip_best_weapon: 'Equip the best weapon already carried before taking another risky action.',
  prepare_combat: 'Prepare for combat before continuing: obtain/equip the best weapon possible from current inventory, crafting capability, or base storage.',
  gather_materials: 'Gather the missing basic materials needed for the next useful tool or weapon instead of continuing unprepared.',
  craft_tool: 'Craft and equip the tool required by the current objective using materials already available.',
  equip_tool: 'Equip the best suitable tool already carried for the current objective.',
  find_food: 'Find or collect food because current food reserves are not sufficient for safe progress.',
  return_base: 'Return to the known base to recover, resupply, store items, or prepare before continuing.',
  store_items: 'Store carried resources at the base to free inventory space, then continue the objective.',
  sleep_or_shelter: 'Use the base or shelter to get through the unsafe night before resuming the objective.',
  replan_route: 'Stop repeating the failed route and choose the known alternative route before retrying the objective.',
  continue_objective: 'Continue the current objective because immediate survival and preparation needs are already handled.',
  wait: 'Wait only because the state contains a concrete reason that progress cannot usefully continue yet.',
  stop_task: 'Stop the current task because it was explicitly cancelled or cannot be safely/progressively continued.'
}

function copy(value) {
  return JSON.parse(JSON.stringify(value))
}

function inventoryCount(state, name) {
  return Number(state?.inventory?.[name] || 0)
}

function bestByScore(inventory = {}, scores = {}) {
  let best = null
  let score = 0
  for (const [name, count] of Object.entries(inventory || {})) {
    if (Number(count) <= 0) continue
    const candidate = Number(scores[name] || 0)
    if (candidate > score) {
      best = name
      score = candidate
    }
  }
  return { name: best, score }
}

function bestWeapon(state) {
  return bestByScore(state?.inventory, WEAPON_SCORE)
}

function bestPickaxe(state) {
  return bestByScore(state?.inventory, PICKAXE_SCORE)
}

function equippedWeaponScore(state) {
  return Number(WEAPON_SCORE[state?.equippedWeapon] || 0)
}

function equippedPickaxeScore(state) {
  return Number(PICKAXE_SCORE[state?.equippedTool] || 0)
}

function hasFood(state) {
  return FOOD_ITEMS.some(name => inventoryCount(state, name) > 0)
}

function craftableSet(state) {
  return new Set(Array.isArray(state?.craftable) ? state.craftable : [])
}

function canPrepareWeapon(state) {
  const craftable = craftableSet(state)
  return bestWeapon(state).score > 0 ||
    craftable.has('stone_sword') ||
    craftable.has('iron_sword') ||
    Boolean(state?.atBase && state?.baseStorage?.weapon)
}

function objectiveType(state) {
  return state?.objective?.type || null
}

function objectiveDone(state) {
  return Boolean(state?.objective?.completed)
}

function needsPickaxe(state) {
  return objectiveType(state) === 'mine_iron'
}

function combatPreparationUseful(state) {
  return ['explore', 'guard', 'mine_iron'].includes(objectiveType(state))
}

function immediateSafety(state) {
  if (state?.cancellationRequested) return 'stop_task'
  if (state?.onFire === true || state?.drowning === true) return 'escape_danger'

  const threat = state?.threat
  if (threat) {
    const distance = Number(threat.distance ?? 999)
    const count = Number(threat.count || 1)
    if (
      threat.type === 'creeper' && distance <= 6 ||
      Number(state.health) <= 6 ||
      count >= 3
    ) return 'escape_danger'
  }

  if (!threat && Number(state?.food) <= 5 && hasFood(state)) return 'eat_now'
  return null
}

function intent(id, state, extra = null) {
  let description = INTENT_DESCRIPTIONS[id] || id
  if (id === 'prepare_combat' && state?.atBase && state?.baseStorage?.weapon) {
    description += ' A usable weapon is available in base storage.'
  }
  if (id === 'wait' && state?.waitReason) {
    description += ` Concrete wait reason: ${state.waitReason}.`
  }
  if (extra) description += ' ' + extra
  return { id, description }
}

function candidateIntents(rawState) {
  const state = rawState || {}
  const forced = immediateSafety(state)
  if (forced) return [intent(forced, state)]

  if (objectiveDone(state)) return []

  const threat = state.threat
  if (threat) {
    const distance = Number(threat.distance ?? 999)
    if (equippedWeaponScore(state) > 0) {
      return [
        intent('fight_threat', state),
        intent('escape_danger', state)
      ]
    }
    if (bestWeapon(state).score > 0 && distance >= 5) {
      return [
        intent('equip_best_weapon', state),
        intent('escape_danger', state)
      ]
    }
    if (canPrepareWeapon(state) && distance >= 8) {
      return [
        intent('prepare_combat', state),
        intent('escape_danger', state)
      ]
    }
    return [intent('escape_danger', state)]
  }

  if (Number(state.food) <= 8 && !hasFood(state)) {
    const options = []
    if (state.nearby?.food) options.push(intent('find_food', state))
    if (state.baseKnown) options.push(intent('return_base', state))
    if (options.length) return options
  }

  if (Number(state.inventoryLoad || 0) >= 0.90) {
    return state.atBase
      ? [intent('store_items', state)]
      : [intent('return_base', state)]
  }

  if (Number(state.consecutiveFailures || 0) >= 3) {
    // If a viable alternative route is known, abandoning the task is not a
    // valid candidate yet. Force the decision layer to try the recovery path
    // before exposing stop_task.
    return state.alternativeRoute
      ? [intent('replan_route', state)]
      : [intent('stop_task', state)]
  }

  if (needsPickaxe(state) && equippedPickaxeScore(state) === 0) {
    if (bestPickaxe(state).score > 0) {
      return [intent('equip_tool', state)]
    }
    const craftable = craftableSet(state)
    if (
      craftable.has('wooden_pickaxe') ||
      craftable.has('stone_pickaxe') ||
      craftable.has('iron_pickaxe')
    ) {
      return [intent('craft_tool', state)]
    }
    return [intent('gather_materials', state)]
  }

  if (
    state.time === 'night' &&
    combatPreparationUseful(state) &&
    equippedWeaponScore(state) === 0
  ) {
    const options = []
    if (!state.atBase && state.baseKnown) options.push(intent('return_base', state))
    if (canPrepareWeapon(state)) options.push(intent('prepare_combat', state))
    if (state.atBase || state.shelterNearby) options.push(intent('sleep_or_shelter', state))
    if (options.length) return options
  }

  if (combatPreparationUseful(state) && equippedWeaponScore(state) === 0) {
    if (bestWeapon(state).score > 0) {
      return [
        intent('equip_best_weapon', state),
        intent('continue_objective', state, 'Continuing now means accepting the risk of proceeding before equipping the carried weapon.')
      ]
    }
    if (canPrepareWeapon(state)) {
      return [
        intent('prepare_combat', state),
        intent('continue_objective', state, 'Continuing now means accepting the risk of proceeding without a prepared weapon.')
      ]
    }
    if (state.nearby?.wood || state.nearby?.stone || state.nearby?.iron) {
      return [
        intent('gather_materials', state),
        intent('continue_objective', state, 'Continuing now means accepting the risk of proceeding without combat preparation.')
      ]
    }
  }

  if (Number(state.food) <= 10 && !hasFood(state) && state.nearby?.food) {
    return [
      intent('find_food', state),
      intent('continue_objective', state)
    ]
  }

  const options = [intent('continue_objective', state)]
  if (state.waitReason) options.push(intent('wait', state))
  if (!state.atBase && state.baseKnown && Number(state.food) <= 10) {
    options.push(intent('return_base', state))
  }
  return options
}

function refreshCapabilities(state) {
  const next = state
  next.inventory = next.inventory || {}
  const craftable = new Set(next.craftable || [])

  const sticks = inventoryCount(next, 'stick')
  const cobble = inventoryCount(next, 'cobblestone')
  const iron = inventoryCount(next, 'iron_ingot')
  const planks = inventoryCount(next, 'oak_planks') +
    inventoryCount(next, 'spruce_planks') +
    inventoryCount(next, 'birch_planks')

  if (sticks >= 1 && cobble >= 2) craftable.add('stone_sword')
  if (sticks >= 2 && cobble >= 3) craftable.add('stone_pickaxe')
  if (sticks >= 1 && iron >= 2) craftable.add('iron_sword')
  if (sticks >= 2 && iron >= 3) craftable.add('iron_pickaxe')
  if (sticks >= 2 && planks >= 3) craftable.add('wooden_pickaxe')

  next.craftable = [...craftable]
  return next
}

function addInventory(state, name, count) {
  state.inventory = state.inventory || {}
  state.inventory[name] = Number(state.inventory[name] || 0) + Number(count || 0)
}

function consumeFood(state) {
  for (const name of FOOD_ITEMS) {
    if (inventoryCount(state, name) <= 0) continue
    state.inventory[name] -= 1
    state.food = Math.min(20, Number(state.food || 0) + 8)
    return name
  }
  return null
}

function setObjectiveProgress(state, amount = 1) {
  if (!state.objective) return
  state.objective.progress = Number(state.objective.progress || 0) + amount
  const target = Number(state.objective.target || 1)
  if (state.objective.progress >= target) {
    state.objective.completed = true
    state.resumePending = false
  }
}

function scriptedEvent(state, scenario) {
  const events = Array.isArray(scenario?.events) ? scenario.events : []
  state.appliedEvents = Array.isArray(state.appliedEvents) ? state.appliedEvents : []

  for (let index = 0; index < events.length; index++) {
    const event = events[index]
    const eventId = String(event.id || index)
    if (state.appliedEvents.includes(eventId)) continue
    if (
      event.afterProgress != null &&
      Number(state?.objective?.progress || 0) >= Number(event.afterProgress)
    ) {
      state.appliedEvents.push(eventId)
      if (event.threat) state.threat = copy(event.threat)
      if (event.time) state.time = event.time
      return event
    }
  }
  return null
}

function applyIntent(rawState, id, rawScenario = {}) {
  const state = refreshCapabilities(copy(rawState))
  const scenario = copy(rawScenario)
  const result = {
    ok: true,
    safetyViolation: false,
    note: null
  }

  if (id === 'stop_task') {
    state.stopped = true
    if (state.objective && state.cancellationRequested) state.objective.cancelled = true
    state.cancellationRequested = false
  } else if (id === 'escape_danger') {
    if (!state.threat && !state.onFire && !state.drowning) {
      result.ok = false
      result.note = 'no_threat'
    } else {
      state.threat = null
      state.onFire = false
      state.drowning = false
      state.safe = true
      state.interruptions = Number(state.interruptions || 0) + 1
      if (state.objective && !state.objective.completed) state.resumePending = true
    }
  } else if (id === 'eat_now') {
    const eaten = consumeFood(state)
    if (!eaten) {
      result.ok = false
      result.note = 'no_food'
    } else {
      result.note = `ate_${eaten}`
    }
  } else if (id === 'fight_threat') {
    if (!state.threat || equippedWeaponScore(state) === 0) {
      result.ok = false
      result.safetyViolation = true
      result.note = 'fight_unprepared'
    } else if (state.threat.type === 'creeper' && Number(state.threat.distance) <= 4) {
      state.health = Math.max(0, Number(state.health || 0) - 8)
      state.threat = null
      result.safetyViolation = true
      result.note = 'fought_close_creeper'
    } else {
      if (state.objective && !state.objective.completed) state.resumePending = true
      state.health = Math.max(1, Number(state.health || 0) - 2)
      state.threat = null
      state.kills = Number(state.kills || 0) + 1
    }
  } else if (id === 'equip_best_weapon') {
    const best = bestWeapon(state)
    if (!best.name) {
      result.ok = false
      result.note = 'no_weapon'
    } else {
      state.equippedWeapon = best.name
    }
  } else if (id === 'prepare_combat') {
    const carried = bestWeapon(state)
    if (carried.name) {
      state.equippedWeapon = carried.name
    } else if (state.atBase && state.baseStorage?.weapon) {
      const name = state.baseStorage.weapon
      addInventory(state, name, 1)
      state.equippedWeapon = name
    } else {
      const craftable = craftableSet(state)
      const name = craftable.has('iron_sword')
        ? 'iron_sword'
        : craftable.has('stone_sword')
          ? 'stone_sword'
          : null
      if (!name) {
        result.ok = false
        result.note = 'cannot_prepare_weapon'
      } else {
        addInventory(state, name, 1)
        state.equippedWeapon = name
      }
    }
  } else if (id === 'gather_materials') {
    if (needsPickaxe(state)) {
      addInventory(state, 'stick', 2)
      addInventory(state, 'cobblestone', 3)
    } else if (combatPreparationUseful(state)) {
      addInventory(state, 'stick', 1)
      addInventory(state, 'cobblestone', 2)
    } else {
      addInventory(state, 'oak_planks', 4)
      addInventory(state, 'stick', 2)
      addInventory(state, 'cobblestone', 3)
    }
    state.inventoryLoad = Math.min(1, Number(state.inventoryLoad || 0) + 0.15)
  } else if (id === 'craft_tool') {
    const craftable = craftableSet(state)
    const name = craftable.has('iron_pickaxe')
      ? 'iron_pickaxe'
      : craftable.has('stone_pickaxe')
        ? 'stone_pickaxe'
        : craftable.has('wooden_pickaxe')
          ? 'wooden_pickaxe'
          : null
    if (!name) {
      result.ok = false
      result.note = 'tool_not_craftable'
    } else {
      addInventory(state, name, 1)
      state.equippedTool = name
    }
  } else if (id === 'equip_tool') {
    const best = bestPickaxe(state)
    if (!best.name) {
      result.ok = false
      result.note = 'no_pickaxe'
    } else {
      state.equippedTool = best.name
    }
  } else if (id === 'find_food') {
    if (!state.nearby?.food) {
      result.ok = false
      result.note = 'food_not_found'
    } else {
      addInventory(state, 'bread', 2)
      state.inventoryLoad = Math.min(1, Number(state.inventoryLoad || 0) + 0.05)
    }
  } else if (id === 'return_base') {
    if (!state.baseKnown) {
      result.ok = false
      result.note = 'base_unknown'
    } else {
      state.atBase = true
      state.safe = true
    }
  } else if (id === 'store_items') {
    if (!state.atBase) {
      result.ok = false
      result.note = 'not_at_base'
    } else {
      state.inventoryLoad = 0.20
      state.storedTrips = Number(state.storedTrips || 0) + 1
    }
  } else if (id === 'sleep_or_shelter') {
    if (!(state.atBase || state.shelterNearby)) {
      result.ok = false
      result.note = 'no_shelter'
    } else {
      state.time = 'day'
      state.rested = true
    }
  } else if (id === 'replan_route') {
    if (!state.alternativeRoute) {
      result.ok = false
      result.note = 'no_alternative_route'
    } else {
      state.consecutiveFailures = 0
      state.alternativeRoute = false
      state.routeReplanned = true
    }
  } else if (id === 'wait') {
    if (!state.waitReason) {
      result.ok = false
      result.note = 'no_wait_reason'
    } else {
      state.waitCycles = Number(state.waitCycles || 0) + 1
      if (Number(state.waitCycles) >= Number(state.waitCyclesNeeded || 1)) {
        state.waitReason = null
      }
    }
  } else if (id === 'continue_objective') {
    if (!state.objective || state.objective.completed) {
      result.ok = false
      result.note = 'no_active_objective'
    } else if (needsPickaxe(state) && equippedPickaxeScore(state) === 0) {
      state.consecutiveFailures = Number(state.consecutiveFailures || 0) + 1
      result.ok = false
      result.note = 'missing_pickaxe'
    } else {
      const wasResumePending = Boolean(state.resumePending)
      if (objectiveType(state) === 'mine_iron') {
        addInventory(state, 'raw_iron', 3)
        state.inventoryLoad = Math.min(1, Number(state.inventoryLoad || 0) + 0.22)
      } else if (objectiveType(state) === 'explore') {
        state.explored = Number(state.explored || 0) + 1
      }
      setObjectiveProgress(state, 1)
      if (wasResumePending) {
        state.resumePending = false
        state.resumedAfterInterrupt = true
      }
      scriptedEvent(state, scenario)
    }
  } else {
    result.ok = false
    result.note = 'unknown_intent'
  }

  refreshCapabilities(state)
  state.lastIntent = id
  state.lastResult = copy(result)
  return { state, result }
}

function stateSignature(state) {
  return JSON.stringify({
    health: state.health,
    food: state.food,
    threat: state.threat,
    equippedWeapon: state.equippedWeapon,
    equippedTool: state.equippedTool,
    inventory: state.inventory,
    objective: state.objective,
    atBase: state.atBase,
    time: state.time,
    inventoryLoad: state.inventoryLoad,
    consecutiveFailures: state.consecutiveFailures,
    alternativeRoute: state.alternativeRoute,
    waitReason: state.waitReason,
    resumePending: state.resumePending,
    routeReplanned: state.routeReplanned,
    appliedEvents: state.appliedEvents
  })
}

function conditionMet(state, key, expected) {
  if (key === 'objectiveComplete') return Boolean(state.objective?.completed) === Boolean(expected)
  if (key === 'threatCleared') return Boolean(!state.threat) === Boolean(expected)
  if (key === 'weaponReady') return (equippedWeaponScore(state) > 0) === Boolean(expected)
  if (key === 'pickaxeReady') return (equippedPickaxeScore(state) > 0) === Boolean(expected)
  if (key === 'healthMin') return Number(state.health || 0) >= Number(expected)
  if (key === 'foodMin') return Number(state.food || 0) >= Number(expected)
  if (key === 'atBase') return Boolean(state.atBase) === Boolean(expected)
  if (key === 'time') return state.time === expected
  if (key === 'routeReplanned') return Boolean(state.routeReplanned) === Boolean(expected)
  if (key === 'stopped') return Boolean(state.stopped) === Boolean(expected)
  if (key === 'storedTripsMin') return Number(state.storedTrips || 0) >= Number(expected)
  if (key === 'resumedAfterInterrupt') return Boolean(state.resumedAfterInterrupt) === Boolean(expected)
  if (key === 'objectiveProgressMin') return Number(state.objective?.progress || 0) >= Number(expected)
  return false
}

function scenarioSuccess(state, scenario) {
  const success = scenario?.success || {}
  return Object.entries(success).every(([key, expected]) => conditionMet(state, key, expected))
}

function deterministicPlayerPolicy(_state, candidates) {
  return candidates[0]?.id || null
}

async function runScenario(scenario, policy, {
  maxSteps = Number(scenario.maxSteps || 10),
  policyName = 'policy'
} = {}) {
  let state = refreshCapabilities(copy(scenario.initialState || {}))
  const mutableScenario = copy(scenario)
  const trace = []
  const seen = new Map()
  let modelCalls = 0
  let modelRequests = 0
  let invalidChoices = 0
  let safetyViolations = 0
  let loopDetected = false
  const latencies = []

  if (scenarioSuccess(state, mutableScenario)) {
    return {
      id: scenario.id,
      policy: policyName,
      success: true,
      steps: 0,
      modelCalls,
      modelRequests,
      invalidChoices,
      safetyViolations,
      loopDetected,
      latencies,
      finalState: state,
      trace
    }
  }

  for (let step = 1; step <= maxSteps; step++) {
    const candidates = candidateIntents(state)
    if (!candidates.length) break

    let choice
    let source = 'forced'
    let latencyMs = 0
    let memoryMb = null
    let stepModelCalls = 0

    if (candidates.length === 1) {
      choice = candidates[0].id
    } else {
      const started = Date.now()
      const decision = await policy(copy(state), copy(candidates), {
        scenario: mutableScenario,
        step
      })
      latencyMs = Number(decision?.latency_ms ?? (Date.now() - started))
      choice = typeof decision === 'string' ? decision : decision?.choice
      source = typeof decision === 'string' ? policyName : (decision?.source || policyName)
      memoryMb = Number.isFinite(Number(decision?.rss_mb)) ? Number(decision.rss_mb) : null
      if (policyName !== 'rules') {
        modelRequests++
        stepModelCalls = Number(decision?.model_calls)
        if (!Number.isFinite(stepModelCalls)) {
          const decisionSource = String(decision?.source || '')
          stepModelCalls = choice && !decisionSource.includes('_error') && !decisionSource.includes('_fallback') ? 1 : 0
        }
        modelCalls += stepModelCalls
      }
      if (Number.isFinite(latencyMs)) latencies.push(latencyMs)
    }

    if (!candidates.some(candidate => candidate.id === choice)) {
      invalidChoices++
      choice = deterministicPlayerPolicy(state, candidates)
      source = 'invalid_fallback'
    }

    const beforeSignature = stateSignature(state)
    const applied = applyIntent(state, choice, mutableScenario)
    state = applied.state
    if (applied.result.safetyViolation) safetyViolations++

    const key = beforeSignature + '|' + choice
    seen.set(key, Number(seen.get(key) || 0) + 1)
    if (seen.get(key) >= 3) loopDetected = true

    trace.push({
      step,
      candidates: candidates.map(candidate => candidate.id),
      choice,
      source,
      latency_ms: latencyMs,
      memory_mb: memoryMb,
      model_calls: stepModelCalls,
      result: applied.result,
      state: copy(state)
    })

    if (loopDetected || scenarioSuccess(state, mutableScenario)) break
  }

  return {
    id: scenario.id,
    policy: policyName,
    success: scenarioSuccess(state, mutableScenario),
    steps: trace.length,
    modelCalls,
    modelRequests,
    invalidChoices,
    safetyViolations,
    loopDetected,
    latencies,
    finalState: state,
    trace
  }
}

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[index]
}

function summarizeRuns(runs) {
  const allLatencies = runs.flatMap(run => run.latencies || [])
  const steps = runs.map(run => Number(run.steps || 0))
  const totalModelCalls = runs.reduce((sum, run) => sum + Number(run.modelCalls || 0), 0)
  const totalModelRequests = runs.reduce((sum, run) => sum + Number(run.modelRequests || 0), 0)
  const traces = runs.flatMap(run => run.trace || [])
  return {
    scenarios: runs.length,
    success_rate: runs.length ? runs.filter(run => run.success).length / runs.length : null,
    safety_violations: runs.reduce((sum, run) => sum + Number(run.safetyViolations || 0), 0),
    loop_rate: runs.length ? runs.filter(run => run.loopDetected).length / runs.length : null,
    invalid_choices: runs.reduce((sum, run) => sum + Number(run.invalidChoices || 0), 0),
    fallbacks: traces.filter(step => String(step.source || '').includes('_fallback')).length,
    technical_fallbacks: traces.filter(step => String(step.source || '').includes('_fallback') && step.source !== 'invalid_fallback').length,
    invalid_choice_fallbacks: traces.filter(step => step.source === 'invalid_fallback').length,
    forced_steps: traces.filter(step => step.source === 'forced').length,
    avg_steps: steps.length ? steps.reduce((a, b) => a + b, 0) / steps.length : null,
    model_calls: totalModelCalls,
    model_requests: totalModelRequests,
    p50_ms: percentile(allLatencies, 0.50),
    p95_ms: percentile(allLatencies, 0.95),
    peak_rss_mb: percentile(traces.map(step => step.memory_mb).filter(Number.isFinite), 1)
  }
}

module.exports = {
  FOOD_ITEMS,
  WEAPON_SCORE,
  PICKAXE_SCORE,
  INTENT_DESCRIPTIONS,
  bestWeapon,
  bestPickaxe,
  equippedWeaponScore,
  equippedPickaxeScore,
  hasFood,
  immediateSafety,
  candidateIntents,
  refreshCapabilities,
  applyIntent,
  scenarioSuccess,
  deterministicPlayerPolicy,
  runScenario,
  summarizeRuns,
  stateSignature
}
