'use strict'

const ALLOWED_ACTIONS = new Set([
  'gather', 'craft', 'smelt', 'eat', 'move', 'deposit',
  'withdraw', 'build', 'fight', 'wait', 'stop'
])

function normalizeThreshold(value, fallback = null) {
  if (value == null || value === '') return fallback
  const threshold = Number(value)
  return Number.isFinite(threshold) ? threshold : fallback
}

function normalizeTimeout(value, fallback) {
  const timeout = Number(value)
  return Number.isFinite(timeout) && timeout > 0 ? timeout : fallback
}

class RemoteDecisionEngine {
  constructor({
    mode,
    source,
    endpoint,
    threshold = null,
    timeoutMs = 1500,
    requireTrusted = false,
    fetchImpl = global.fetch,
    logger = console
  } = {}) {
    this.mode = mode
    this.source = source
    this.endpoint = endpoint
    this.threshold = normalizeThreshold(threshold)
    this.timeoutMs = normalizeTimeout(timeoutMs, 1500)
    this.requireTrusted = requireTrusted
    this.fetch = fetchImpl
    this.logger = logger
  }

  enabled() {
    return process.env.MBOT_DECISION_ENGINE === this.mode && Boolean(this.endpoint)
  }

  async decide(state, fallback) {
    if (!this.enabled()) return this.fallback('disabled', fallback)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const hasDynamicMask = Array.isArray(state?.availableActions)
      const availableActions = hasDynamicMask
        ? state.availableActions.filter(action => ALLOWED_ACTIONS.has(action))
        : undefined

      const response = await this.fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          state,
          available_actions: availableActions
        }),
        signal: controller.signal
      })

      if (!response.ok) return this.fallback(`http_${response.status}`, fallback)

      const value = await response.json()
      if (!value || !ALLOWED_ACTIONS.has(value.action)) {
        return this.fallback('invalid_action', fallback)
      }
      if (hasDynamicMask && !availableActions.includes(value.action)) {
        return this.fallback('unavailable_action', fallback)
      }
      if (
        value.trusted === false ||
        (this.requireTrusted && value.trusted !== true)
      ) {
        return this.fallback('untrusted', fallback)
      }

      const confidence = Number(value.confidence)
      if (
        this.threshold != null &&
        (!Number.isFinite(confidence) || confidence < this.threshold)
      ) {
        return this.fallback('low_confidence', fallback)
      }

      return {
        source: this.source,
        action: value.action,
        confidence: Number.isFinite(confidence) ? confidence : null,
        probabilities: value.probabilities || null,
        routing: value.routing || null,
        trusted: true
      }
    } catch (error) {
      return this.fallback(
        error?.name === 'AbortError' ? 'timeout' : 'error',
        fallback
      )
    } finally {
      clearTimeout(timer)
    }
  }

  fallback(reason, fallback) {
    const value = typeof fallback === 'function' ? fallback() : fallback
    return {
      source: 'deterministic',
      reason,
      ...(value || { action: 'wait' })
    }
  }
}

class DecisionEngine extends RemoteDecisionEngine {
  constructor({
    endpoint = process.env.CONVERSA_DECISION_URL,
    threshold = normalizeThreshold(
      process.env.CONVERSA_DECISION_THRESHOLD,
      0.70
    ),
    timeoutMs = 1500,
    fetchImpl = global.fetch,
    logger = console
  } = {}) {
    super({
      mode: 'conversa-llm',
      source: 'conversa-llm',
      endpoint,
      threshold,
      timeoutMs,
      requireTrusted: false,
      fetchImpl,
      logger
    })
  }
}

class LayaDecisionEngine extends RemoteDecisionEngine {
  constructor({
    endpoint = process.env.LAYA_DECISION_URL,
    threshold = normalizeThreshold(process.env.LAYA_DECISION_THRESHOLD),
    timeoutMs = normalizeTimeout(
      process.env.LAYA_DECISION_TIMEOUT_MS,
      4000
    ),
    fetchImpl = global.fetch,
    logger = console
  } = {}) {
    super({
      mode: 'laya',
      source: 'laya',
      endpoint,
      threshold,
      timeoutMs,
      requireTrusted: true,
      fetchImpl,
      logger
    })
  }
}

function minecraftState(bot, objective = null) {
  const inventory = {}
  for (const item of bot?.inventory?.items?.() || []) {
    inventory[item.name] = (inventory[item.name] || 0) + item.count
  }
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

module.exports = {
  RemoteDecisionEngine,
  DecisionEngine,
  LayaDecisionEngine,
  minecraftState,
  ALLOWED_ACTIONS,
  normalizeThreshold,
  normalizeTimeout
}
