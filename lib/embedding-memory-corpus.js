'use strict'

// Offline/shadow-only corpus builder for semantic experience retrieval.
// It never executes a Mineflayer action and never changes Julia/Rules authority.

const EPISODE_TYPES = ['julia_authority_cycle', 'julia_shadow_decision']

// Fields that only exist after (or as) the decision. They may appear in the
// historical document but must never influence the query text.
const POST_DECISION_FIELDS = [
  'choice', 'juliaChoice', 'juliaAttemptedChoice', 'juliaConfidence', 'rulesChoice', 'deterministicChoice',
  'realIntent', 'executedChoice', 'action', 'result', 'nextState', 'settledAt', 'validation', 'source',
  'agreesWithRules', 'agreesWithReal', 'agreesWithDeterministic', 'safetyOverride', 'wouldViolateSafety'
]

const QUERY_VARIANTS = ['full', 'no_inventory', 'no_candidates', 'no_distances', 'compact']

const BLOCKED_CODES = new Set(['NOT_ARRIVED', 'SHELTER_FAILED', 'RECIPE_INPUTS_NOT_CONFIRMED', 'RECIPE_INPUTS_CHANGED', 'NOT_SETTLED', 'TIMEOUT'])
const CANCELLED_CODES = new Set(['CANCELLED', 'PLAYER_LOOP_PREEMPTED', 'DISCONNECTED'])

function bool(value) {
  return value === true ? 'yes' : value === false ? 'no' : 'unknown'
}

function clean(value) {
  if (value == null) return 'none'
  return String(value).replace(/[\r\n|]+/g, ' ').slice(0, 160)
}

function bucket(value, low, mid) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 'unknown'
  return n <= low ? 'low' : n <= mid ? 'mid' : 'high'
}

function threatType(state = {}) {
  return state.threat ? clean(state.threat.type || state.threat.name) : 'none'
}

function threatBucket(state = {}) {
  if (!state.threat) return 'none'
  const d = Number(state.threat.distance)
  return !Number.isFinite(d) ? 'unknown' : d <= 4 ? 'close' : d <= 10 ? 'near' : 'far'
}

function inventoryText(state = {}) {
  if (!state.inventory || typeof state.inventory !== 'object') return ''
  return Object.entries(state.inventory).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${k}:${n}`).slice(0, 16).join(', ')
}

function nearbyText(state = {}, withDistances = true) {
  const nearby = state.nearby || {}
  return ['food', 'wood', 'stone', 'iron']
    .map((kind) => {
      const d = nearby[`${kind}Distance`]
      return `${kind}=${bool(nearby[kind])}${withDistances && d != null ? `@${Number(d).toFixed(1)}` : ''}`
    })
    .join(', ')
}

// Pre-decision text only: state at decision time + available candidates.
function stateToQuery(state = {}, candidates = [], variant = 'full') {
  state = state || {}
  const cands = (candidates || []).map(clean).join(', ') || 'none'
  if (variant === 'compact') {
    return [
      `hp=${bucket(state.health, 6, 14)} food=${bucket(state.food, 6, 14)} ${clean(state.time)}`,
      `threat=${threatType(state)}:${threatBucket(state)} weapon=${clean(state.equippedWeapon)} base=${bool(state.atBase)}`,
      `options: ${cands}`
    ].join('; ')
  }
  const withDistances = variant !== 'no_distances'
  const threat = state.threat
    ? `${threatType(state)}${withDistances ? ` at distance ${clean(state.threat.distance)}` : ` ${threatBucket(state)}`}`
    : 'none'
  return [
    'Minecraft bot situation.',
    `health=${clean(state.health)} food=${clean(state.food)} time=${clean(state.time)}`,
    `threat=${threat} equipped_weapon=${clean(state.equippedWeapon)} at_base=${bool(state.atBase)}`,
    `nearby: ${nearbyText(state, withDistances)}`,
    variant === 'no_inventory' ? '' : `inventory: ${inventoryText(state) || 'empty'}`,
    `objective=${clean(state.objective?.type)} failures=${clean(state.consecutiveFailures)}`,
    variant === 'no_candidates' ? '' : `candidate_actions: ${cands}`
  ].filter(Boolean).join(' ')
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

// Situation category derived ONLY from pre-decision information.
function situationCategory(state = {}, candidates = []) {
  const c = new Set(candidates || [])
  if ((state && state.threat) || c.has('escape_danger') || c.has('fight_threat') || c.has('equip_best_weapon')) return 'THREAT'
  if (c.has('find_food') || c.has('eat')) return 'FOOD'
  if (c.has('prepare_combat')) return 'PREPARATION'
  if (c.has('sleep_or_shelter')) return 'SHELTER'
  if (c.has('gather_materials')) return 'GATHER'
  if (c.has('return_base')) return 'NAVIGATION'
  if (Number(state?.food) <= 6) return 'FOOD'
  return 'EXPLORATION'
}

function outcomeFlags(result = {}, state = {}, nextState = null) {
  const code = result.code || null
  const healthLost = nextState && Number.isFinite(Number(state.health)) && Number.isFinite(Number(nextState.health))
    ? Number(nextState.health) < Number(state.health) - 0.5
    : false
  return {
    failed: result.ok !== true,
    safety: code === 'SAFETY_PRECEDENCE' || result.safetyViolation === true,
    cancelled: result.cancelled === true || CANCELLED_CODES.has(code),
    blocked: BLOCKED_CODES.has(code),
    healthLost
  }
}

function unwrap(event) {
  if (!event || typeof event !== 'object') return null
  // timeline evidence wraps the decision under `data`
  if (EPISODE_TYPES.includes(event.type) && !event.state && event.data && typeof event.data === 'object') {
    return { ...event.data, type: event.type }
  }
  return event
}

function cycleToEpisode(rawEvent, index = 0, sourceId = null) {
  const event = unwrap(rawEvent)
  if (!event || !EPISODE_TYPES.includes(event.type)) return null
  if (!event.state || !event.result) return null

  const candidates = Array.isArray(event.candidates)
    ? event.candidates.map(String)
    : Array.isArray(event.candidateIds) ? event.candidateIds.map(String) : []
  // The outcome belongs to the action that was actually executed: Julia's choice in
  // authority cycles, the real intent in shadow decisions (Julia only observed).
  const action = event.type === 'julia_shadow_decision'
    ? (event.realIntent || event.result?.intent || null)
    : (event.choice || event.result?.intent || null)
  const query = stateToQuery(event.state, candidates)
  const flags = outcomeFlags(event.result, event.state, event.nextState)
  const history = [
    `chosen_action=${clean(action)}`,
    `outcome: ${resultSummary(event.result)}`,
    event.nextState ? `next_state: health=${clean(event.nextState.health)} food=${clean(event.nextState.food)} threat=${event.nextState.threat ? clean(event.nextState.threat.type || event.nextState.threat.name) : 'none'} at_base=${bool(event.nextState.atBase)}` : ''
  ].filter(Boolean).join(' ')
  const variants = {}
  for (const v of QUERY_VARIANTS) {
    const q = stateToQuery(event.state, candidates, v)
    variants[v] = { query: q, document: `Past Minecraft bot experience. ${q} ${history}` }
  }
  const s = event.state
  const decisionId = clean(event.decisionId || `episode-${index + 1}`)

  return {
    id: sourceId ? `${sourceId}:${decisionId}` : decisionId,
    source: sourceId,
    decidedAt: event.decidedAt || event.time || null,
    settledAt: event.settledAt || event.time || event.decidedAt || null,
    worker: event.worker || null,
    candidates,
    action,
    success: event.result?.ok === true,
    code: event.result?.code || null,
    flags,
    category: situationCategory(s, candidates),
    features: {
      threat: threatType(s),
      threatDistance: threatBucket(s),
      health: bucket(s.health, 6, 14),
      food: bucket(s.food, 6, 14),
      objective: clean(s.objective?.type),
      candidateSet: [...candidates].sort().join('+')
    },
    query,
    document: variants.full.document,
    variants
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

// events: plain events, or { event, source } pairs when multiple runs are merged.
function buildEpisodes(events) {
  const seen = new Set()
  const out = []
  ;(events || []).forEach((item, i) => {
    const wrapped = item && item.event && Object.prototype.hasOwnProperty.call(item, 'source')
    const ep = wrapped ? cycleToEpisode(item.event, i, item.source) : cycleToEpisode(item, i)
    if (!ep) return
    // same decision logged twice (e.g. copied evidence) must not inflate the corpus
    const key = `${ep.worker}|${ep.decidedAt}|${ep.query}|${ep.action}|${ep.code}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(ep)
  })
  return out.sort((a, b) => String(a.settledAt || '').localeCompare(String(b.settledAt || '')))
}

// Memory available when episode `i` is decided: only episodes that had already
// settled (outcome known) strictly before its decision time. Never future ones.
function priorEpisodeIndices(episodes, i) {
  const t = String(episodes[i]?.decidedAt || '')
  const out = []
  for (let j = 0; j < episodes.length; j++) {
    if (j === i) continue
    if (String(episodes[j].settledAt || '') < t) out.push(j)
  }
  return out
}

function corpusStats(episodes) {
  const count = (fn) => episodes.reduce((acc, e) => { const k = fn(e); acc[k] = (acc[k] || 0) + 1; return acc }, {})
  const contested = episodes.filter((e) => e.candidates.length >= 2)
  return {
    episodes_total: episodes.length,
    contested_decisions: contested.length,
    forced_decisions: episodes.length - contested.length,
    successful: episodes.filter((e) => e.success).length,
    failed: episodes.filter((e) => !e.success).length,
    contested_successful: contested.filter((e) => e.success).length,
    contested_failed: contested.filter((e) => !e.success).length,
    actions: count((e) => e.action),
    contested_actions: contested.reduce((acc, e) => { acc[e.action] = (acc[e.action] || 0) + 1; return acc }, {}),
    categories: count((e) => e.category),
    contested_categories: contested.reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + 1; return acc }, {}),
    contested_candidate_sets: contested.reduce((acc, e) => { acc[e.features.candidateSet] = (acc[e.features.candidateSet] || 0) + 1; return acc }, {}),
    result_codes: count((e) => e.code || 'OK_OR_NONE'),
    sources: count((e) => e.source || 'unknown'),
    flags: {
      safety: episodes.filter((e) => e.flags.safety).length,
      cancelled: episodes.filter((e) => e.flags.cancelled).length,
      blocked: episodes.filter((e) => e.flags.blocked).length,
      healthLost: episodes.filter((e) => e.flags.healthLost).length
    }
  }
}

module.exports = {
  EPISODE_TYPES,
  POST_DECISION_FIELDS,
  QUERY_VARIANTS,
  stateToQuery,
  resultSummary,
  situationCategory,
  outcomeFlags,
  cycleToEpisode,
  parseJsonl,
  buildEpisodes,
  priorEpisodeIndices,
  corpusStats
}
