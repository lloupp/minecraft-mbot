'use strict'

const ALLOWED_ACTIONS = new Set([
  'gather', 'craft', 'smelt', 'eat', 'move', 'deposit',
  'withdraw', 'build', 'fight', 'wait', 'stop'
])

class DecisionEngine {
  constructor({ endpoint = process.env.CONVERSA_DECISION_URL, threshold = Number(process.env.CONVERSA_DECISION_THRESHOLD || 0.70), timeoutMs = 1500, fetchImpl = global.fetch, logger = console } = {}) {
    this.endpoint = endpoint
    this.threshold = threshold
    this.timeoutMs = timeoutMs
    this.fetch = fetchImpl
    this.logger = logger
  }

  enabled() {
    return process.env.MBOT_DECISION_ENGINE === 'conversa-llm' && Boolean(this.endpoint)
  }

  async decide(state, fallback) {
    if (!this.enabled()) return this.fallback('disabled', fallback)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          state,
          available_actions: Array.isArray(state?.availableActions)
            ? state.availableActions.filter(action => ALLOWED_ACTIONS.has(action))
            : undefined
        }),
        signal: controller.signal
      })
      if (!response.ok) return this.fallback(`http_${response.status}`, fallback)
      const value = await response.json()
      if (!value || !ALLOWED_ACTIONS.has(value.action)) return this.fallback('invalid_action', fallback)
      const confidence = Number(value.confidence)
      if (!Number.isFinite(confidence) || confidence < this.threshold || value.trusted === false) {
        return this.fallback('low_confidence', fallback)
      }
      return { source: 'conversa-llm', action: value.action, confidence, trusted: true }
    } catch (error) {
      return this.fallback(error?.name === 'AbortError' ? 'timeout' : 'error', fallback)
    } finally {
      clearTimeout(timer)
    }
  }

  fallback(reason, fallback) {
    const value = typeof fallback === 'function' ? fallback() : fallback
    return { source: 'deterministic', reason, ...(value || { action: 'wait' }) }
  }
}

function minecraftState(bot, objective = null) {
  const inventory = {}
  for (const item of bot?.inventory?.items?.() || []) inventory[item.name] = (inventory[item.name] || 0) + item.count
  return {
    health: Number(bot?.health ?? 0),
    food: Number(bot?.food ?? 0),
    position: bot?.entity?.position ? {
      x: Math.floor(bot.entity.position.x),
      y: Math.floor(bot.entity.position.y),
      z: Math.floor(bot.entity.position.z)
    } : null,
    inventory,
    objective
  }
}

module.exports = { DecisionEngine, minecraftState, ALLOWED_ACTIONS }
