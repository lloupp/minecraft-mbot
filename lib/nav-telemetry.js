// lib/nav-telemetry.js
// Observa os eventos do mineflayer-pathfinder sem alterar nenhuma decisão.
// Antes disto, todo erro de navegação virava "timeout" genérico: noPath,
// dig_error, place_error e stuck eram indistinguíveis no log.
//
// O estado fica num WeakMap por bot; attach() é idempotente e nunca chama a API
// do pathfinder, então pode rodar antes do spawn sem derrubar o processo.

'use strict'

const states = new WeakMap()

const RESET_FAILURES = Object.freeze({
  stuck: 'PATH_STUCK',
  dig_error: 'PATH_DIG_ERROR',
  place_error: 'PATH_PLACE_ERROR',
  no_scaffolding_blocks: 'PATH_NO_SCAFFOLD'
})

const EMPTY_COUNTS = () => ({
  success: 0,
  partial: 0,
  timeout: 0,
  noPath: 0,
  resets: 0,
  reached: 0,
  stopped: 0
})

function attach(bot) {
  if (!bot || typeof bot.on !== 'function') return null
  const existing = states.get(bot)
  if (existing) return existing

  const state = {
    lastStatus: null,
    lastResetReason: null,
    lastFailure: null,
    lastAt: null,
    lastReachedAt: null,
    lastStopAt: null,
    counts: EMPTY_COUNTS()
  }
  states.set(bot, state)

  bot.on('path_update', (payload) => {
    const status = typeof payload === 'string' ? payload : payload?.status
    if (!status) return
    state.lastStatus = String(status)
    state.lastAt = Date.now()
    state.counts[status] = (state.counts[status] || 0) + 1
    if (status === 'noPath' || status === 'timeout') {
      state.lastFailure = {
        code: status === 'noPath' ? 'PATH_NO_PATH' : 'PATH_TIMEOUT',
        reason: status,
        at: state.lastAt
      }
    } else if (status === 'success') {
      state.lastFailure = null
    }
  })

  bot.on('path_reset', (reason) => {
    state.lastResetReason = reason == null ? null : String(reason)
    state.lastAt = Date.now()
    state.counts.resets++
    const code = RESET_FAILURES[state.lastResetReason]
    if (code) state.lastFailure = { code, reason: state.lastResetReason, at: state.lastAt }
  })

  bot.on('goal_reached', () => {
    state.lastReachedAt = Date.now()
    state.counts.reached++
    state.lastFailure = null
  })

  bot.on('path_stop', () => {
    state.lastStopAt = Date.now()
    state.counts.stopped++
  })

  return state
}

function snapshot(bot) {
  const state = bot ? states.get(bot) : null
  return state ? structuredClone(state) : null
}

function lastFailure(bot) {
  const failure = bot ? states.get(bot)?.lastFailure : null
  return failure ? { ...failure } : null
}

function reset(bot) {
  if (bot && states.has(bot)) states.delete(bot)
}

module.exports = { attach, snapshot, lastFailure, reset, RESET_FAILURES }
