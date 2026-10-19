'use strict'

// Offline/shadow-only corpus builder for semantic experience retrieval.
// It never executes a Mineflayer action and never changes Julia/Rules authority.

function bool(value) {
  return value === true ? 'yes' : value === false ? 'no' : 'unknown'
}

function clean(value) {
  if (value == null) return 'none'
  return String(value).replace(/[\r\n|]+/g, ' ').slice(0, 160)
}

function stateToQuery(state = {}, candidates = []) {
  const nearby = state.nearby || {}
  const threat = state.threat
    ? `${clean(state.threat.type || state.threat.name)} at distance ${clean(state.threat.distance)}`
    : 'none'
  const inventory = state.inventory && typeof state.inventory === 'object'
    ? Object.entries(state.inventory).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${k}:${n}`).slice(0, 16).join(', ')
    : ''
  const nearbyText = ['food', 'wood', 'stone', 'iron']
    .map((kind) => `${kind}=${bool(nearby[kind])}${nearby[`${kind}Distance`] != null ? `@${Number(nearby[`${kind}Distance`]).toFixed(1)}` : ''}`)
    .join(', ')

  return [
    'Minecraft bot situation.',
    `health=${clean(state.health)} food=${clean(state.food)} time=${clean(state.time)}`,
    `threat=${threat} equipped_weapon=${clean(state.equippedWeapon)} at_base=${bool(state.atBase)}`,
    `nearby: ${nearbyText}`,
    `inventory: ${inventory || 'empty'}`,
    `objective=${clean(state.objective?.type)} failures=${clean(state.consecutiveFailures)}`,
    `candidate_actions: ${(candidates || []).map(clean).join(', ') || 'none'}`
  ].join(' ')
}

function resultSummary(result = {}) {
  const parts = [
    `ok=${bool(result.ok)}`,
    `code=${clean(result.code)}`,
    `intent=${clean(result.intent)}`,
    `threat_handled=${clean(result.threatHandled)}`,
    `combat=${clean(result.combat)}`,
    `food_gathered=${clean(result.foodGathered)}`,
    `ate=${bool(result.ate)}`,
    `returned_to_base=${bool(result.returnedToBase)}`
  ]
  if (result.preparationSkipped) parts.push(`preparation_skipped=${clean(result.preparationSkipped.code || result.preparationSkipped)}`)
  if (result.error) parts.push(`error=${clean(result.error)}`)
  return parts.join(' ')
}

function cycleToEpisode(event, index = 0) {
  if (!event || typeof event !== 'object') return null
  if (!['julia_authority_cycle', 'julia_shadow_decision'].includes(event.type)) return null
  if (!event.state || !event.result) return null

  const candidates = Array.isArray(event.candidates)
    ? event.candidates.map(String)
    : Array.isArray(event.candidateIds) ? event.candidateIds.map(String) : []
  const action = event.choice || event.juliaChoice || event.realIntent || event.executedChoice || event.result?.intent || event.action || null
  const query = stateToQuery(event.state, candidates)
  const document = [
    'Past Minecraft bot experience.',
    query,
    `chosen_action=${clean(action)} deterministic_choice=${clean(event.deterministicChoice || event.rulesChoice)}`,
    `outcome: ${resultSummary(event.result)}`,
    event.nextState ? `next_state: health=${clean(event.nextState.health)} food=${clean(event.nextState.food)} threat=${event.nextState.threat ? clean(event.nextState.threat.type || event.nextState.threat.name) : 'none'} at_base=${bool(event.nextState.atBase)}` : ''
  ].filter(Boolean).join(' ')

  return {
    id: clean(event.decisionId || `episode-${index + 1}`),
    time: event.settledAt || event.time || event.decidedAt || null,
    worker: event.worker || null,
    candidates,
    action,
    success: event.result?.ok === true,
    code: event.result?.code || null,
    query,
    document
  }
}

function parseJsonl(text) {
  const out = []
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* preserve robustness against partial evidence */ }
  }
  return out
}

function buildEpisodes(events) {
  return (events || []).map(cycleToEpisode).filter(Boolean)
    .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))
}

module.exports = { stateToQuery, resultSummary, cycleToEpisode, parseJsonl, buildEpisodes }
