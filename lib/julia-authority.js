// lib/julia-authority.js
// Autoridade da Julia-1 sobre a escolha do player loop (opt-in: MBOT_JULIA_AUTHORITY=1 + JULIA_PLAYER_LOOP_URL).
//
// A Julia só escolhe ENTRE os candidatos que o player loop já gerou; nunca cria ação. A escolha passa pelos
// guardrails (está entre os candidatos? `applyIntent` acusa violação de segurança?) e a execução continua no
// executor determinístico de sempre. Qualquer falha (timeout, sidecar fora, resposta malformada, escolha
// inválida, disjuntor aberto) vira a escolha determinística, registrada com o motivo. Cancelamento durante a
// consulta aborta a requisição e não devolve escolha nenhuma (o dono novo decide).
//
// Desligado (padrão): `enabled()` é falso e o chamador usa a política determinística exatamente como antes.

const { EventLog } = require('./event-log')
const { applyIntent, deterministicPlayerPolicy } = require('./player-loop')

const DEFAULT_TIMEOUT_MS = Number(process.env.JULIA_AUTHORITY_TIMEOUT_MS || 5000)
const DEFAULT_BREAKER_THRESHOLD = Math.max(1, Number(process.env.JULIA_AUTHORITY_BREAKER_THRESHOLD || 5))
const DEFAULT_BREAKER_COOLDOWN_MS = Math.max(1000, Number(process.env.JULIA_AUTHORITY_BREAKER_COOLDOWN_MS || 60000))
const DEFAULT_LOG_FILE = process.env.JULIA_AUTHORITY_LOG || '.data/julia-authority.jsonl'
const CANCEL_POLL_MS = 100

class JuliaAuthority {
  constructor({
    endpoint = process.env.JULIA_PLAYER_LOOP_URL || null,
    enabled = process.env.MBOT_JULIA_AUTHORITY === '1',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    breakerThreshold = DEFAULT_BREAKER_THRESHOLD,
    breakerCooldownMs = DEFAULT_BREAKER_COOLDOWN_MS,
    eventLog = null,
    logFile = DEFAULT_LOG_FILE,
    fetchImpl = global.fetch,
    logger = console,
    now = () => Date.now()
  } = {}) {
    this.endpoint = endpoint
    this._enabled = Boolean(enabled)
    this.timeoutMs = timeoutMs
    this.breakerThreshold = breakerThreshold
    this.breakerCooldownMs = breakerCooldownMs
    this._eventLog = eventLog
    this._logFile = logFile
    this.fetch = fetchImpl
    this.logger = logger
    this.now = now
    this.seq = 0
    this.consecutiveFailures = 0
    this.breakerOpenUntil = 0
    this.open = new Map()   // worker -> decisão aguardando resultado
    this.stats = { decisions: 0, forced: 0, julia: 0, fallback: 0, invalid: 0, timeout: 0, error: 0, safetyRejected: 0, cancelled: 0 }
  }

  enabled() {
    return this._enabled && Boolean(this.endpoint)
  }

  get eventLog() {
    this._eventLog ||= new EventLog(this._logFile)
    return this._eventLog
  }

  // Devolve { choice, source: 'forced'|'julia'|'fallback', fallbackReason?, cancelled? }.
  async decide({ state, candidates, isCancelled = () => false, meta = {} } = {}) {
    const ids = (candidates || []).map((candidate) => candidate.id)
    const id = `${meta.worker || 'worker'}-${++this.seq}`
    const decidedAt = this.now()
    this.stats.decisions++
    const deterministic = deterministicPlayerPolicy(state, candidates || [])
    const record = { decisionId: id, decidedAt: new Date(decidedAt).toISOString(), worker: meta.worker || null,
      taskVersion: meta.taskVersion ?? null, state: summarize(state), candidates: ids, deterministicChoice: deterministic }

    if (ids.length < 2) {
      this.stats.forced++
      return this._open(meta.worker, { ...record, source: 'forced', choice: deterministic, juliaChoice: null, validation: 'forced_single_candidate' })
    }
    if (this.now() < this.breakerOpenUntil) {
      return this._fallback(meta.worker, record, deterministic, 'breaker_open', null)
    }

    const outcome = await this._ask(state, candidates, isCancelled)
    if (outcome.cancelled) {
      this.stats.cancelled++
      this._log('julia_authority_cancelled', { ...record, latencyMs: outcome.latencyMs }, meta.worker)
      return { choice: null, cancelled: true, decisionId: id }
    }
    if (outcome.error) {
      if (outcome.error === 'timeout') this.stats.timeout++
      else if (outcome.error === 'invalid_choice') this.stats.invalid++
      else this.stats.error++
      return this._fallback(meta.worker, { ...record, latencyMs: outcome.latencyMs, juliaAttemptedChoice: outcome.attemptedChoice || null },
        deterministic, outcome.error, outcome.attemptedChoice || null)
    }

    // Guardrail: a escolha não pode violar a segurança segundo o próprio modelo do player loop.
    let violation = null
    try { violation = applyIntent(state, outcome.choice, {}).result?.safetyViolation || null } catch { violation = null }
    if (violation) {
      this.stats.safetyRejected++
      return this._fallback(meta.worker, { ...record, latencyMs: outcome.latencyMs, juliaConfidence: outcome.confidence },
        deterministic, 'safety_violation', outcome.choice)
    }

    this.stats.julia++
    return this._open(meta.worker, { ...record, source: 'julia', choice: outcome.choice, juliaChoice: outcome.choice,
      juliaConfidence: outcome.confidence, latencyMs: outcome.latencyMs, validation: 'ok',
      agreesWithDeterministic: outcome.choice === deterministic })
  }

  // Fecha a decisão aberta do worker com a ação executada, o resultado e o novo estado.
  settle(worker, { action = null, result = null, nextState = null } = {}) {
    const decision = this.open.get(worker)
    if (!decision) return
    this.open.delete(worker)
    this._log('julia_authority_cycle', { ...decision, action, result: summarizeResult(result), nextState: summarize(nextState),
      settledAt: new Date(this.now()).toISOString() }, worker)
  }

  _fallback(worker, record, deterministic, reason, attempted) {
    this.stats.fallback++
    return this._open(worker, { ...record, source: 'fallback', choice: deterministic, juliaChoice: attempted, fallbackReason: reason,
      validation: reason === 'invalid_choice' || reason === 'safety_violation' ? 'rejected' : 'unavailable' })
  }

  _open(worker, decision) {
    // Uma decisão anterior que nunca foi fechada (ex.: exceção no meio) fica registrada como tal, não some.
    if (worker && this.open.has(worker)) this.settle(worker, { action: null, result: { ok: false, code: 'NOT_SETTLED' } })
    if (worker) this.open.set(worker, decision)
    this._log('julia_authority_decision', decision, worker)
    return { choice: decision.choice, source: decision.source, fallbackReason: decision.fallbackReason || null, decisionId: decision.decisionId }
  }

  async _ask(state, candidates, isCancelled) {
    const controller = new AbortController()
    let reason = null
    const timer = setTimeout(() => { reason = 'timeout'; controller.abort() }, this.timeoutMs)
    const poll = setInterval(() => { if (isCancelled()) { reason = 'cancelled'; controller.abort() } }, CANCEL_POLL_MS)
    const started = this.now()
    const latency = () => this.now() - started
    try {
      if (isCancelled()) return { cancelled: true, latencyMs: 0 }
      const response = await this.fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state, candidates: candidates.map((c) => ({ id: c.id, description: c.description })) }),
        signal: controller.signal
      })
      if (isCancelled()) return { cancelled: true, latencyMs: latency() }
      if (!response.ok) { this._onFailure(); return { error: `http_${response.status}`, latencyMs: latency() } }
      const value = await response.json()
      if (!value || typeof value.choice !== 'string') { this._onFailure(); return { error: 'malformed_response', latencyMs: latency() } }
      if (!candidates.some((c) => c.id === value.choice)) {
        this._onFailure()
        return { error: 'invalid_choice', attemptedChoice: value.choice, latencyMs: latency() }
      }
      this.consecutiveFailures = 0
      return { choice: value.choice, confidence: Number.isFinite(Number(value.confidence)) ? Number(value.confidence) : null, latencyMs: latency() }
    } catch (error) {
      if (reason === 'cancelled' || isCancelled()) return { cancelled: true, latencyMs: latency() }
      this._onFailure()
      return { error: reason === 'timeout' ? 'timeout' : `offline:${error?.cause?.code || error?.cause?.errors?.[0]?.code || error?.message || error}`, latencyMs: latency() }
    } finally {
      clearTimeout(timer)
      clearInterval(poll)
    }
  }

  _onFailure() {
    this.consecutiveFailures++
    if (this.consecutiveFailures >= this.breakerThreshold) {
      this.breakerOpenUntil = this.now() + this.breakerCooldownMs
      this.consecutiveFailures = 0
    }
  }

  _log(type, data, worker) {
    try { this.eventLog.log(type, data, worker || null) } catch (error) {
      try { this.logger.log?.(`[julia-authority] falha ao registrar: ${error?.message || error}`) } catch { /* nunca derruba o runtime */ }
    }
  }
}

// Estado resumido para o log (o estado completo vai para a Julia).
function summarize(state) {
  if (!state || typeof state !== 'object') return null
  const inventory = state.inventory && typeof state.inventory === 'object' ? state.inventory : {}
  return {
    health: state.health ?? null,
    food: state.food ?? null,
    time: state.time ?? null,
    threat: state.threat ? { type: state.threat.type || state.threat.name || null, distance: state.threat.distance ?? null } : null,
    equippedWeapon: state.equippedWeapon ?? null,
    atBase: state.atBase ?? null,
    nearby: state.nearby || null,
    craftable: Array.isArray(state.craftable) ? state.craftable : null,
    inventory: Object.fromEntries(Object.entries(inventory).filter(([, count]) => Number(count) > 0))
  }
}

function summarizeResult(result) {
  if (!result || typeof result !== 'object') return result ?? null
  const { ok, code, cancelled, intent, preparationSkipped, returnedToBase, x, z } = result
  return { ok: ok ?? null, code: code || null, error: result.error || null, cancelled: cancelled || false, intent: intent || null,
    preparationSkipped: preparationSkipped || null, returnedToBase: returnedToBase || false,
    threatHandled: result.threatHandled || null, combat: result.combat || null, foodGathered: result.foodGathered || null, ate: result.ate || false,
    exploredTo: Number.isFinite(x) ? { x, z } : null,
    preparationSteps: Array.isArray(result.preparationSteps) ? result.preparationSteps.map((s) => ({ intent: s.intent, ok: s.ok, code: s.code })) : null }
}

module.exports = { JuliaAuthority, summarize }
