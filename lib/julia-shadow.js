// lib/julia-shadow.js
// Shadow mode da Julia-1: mesmo padrão do Laya (lib/laya-shadow.js) — observa
// decisões reais em paralelo, sem autoridade de execução. Toda a mecânica de
// segurança (fire-and-forget, timeout, limite de concorrência, disjuntor,
// escolha validada contra a máscara de candidatos) é herdada do observador do
// Laya; aqui só mudam os padrões (env, log) e o que é registrado por decisão.
//
// `observe()` continua devolvendo sempre `undefined`: a escolha da Julia nunca
// chega ao chamador, então não há como ela virar a ação executada.

const { LayaShadowObserver } = require('./laya-shadow')
const { applyIntent, deterministicPlayerPolicy } = require('./player-loop')

const DEFAULT_TIMEOUT_MS = Number(process.env.JULIA_SHADOW_TIMEOUT_MS || 4000)
const DEFAULT_MAX_CONCURRENT = Math.max(1, Number(process.env.JULIA_SHADOW_MAX_CONCURRENT || 1))
const DEFAULT_BREAKER_THRESHOLD = Math.max(1, Number(process.env.JULIA_SHADOW_BREAKER_THRESHOLD || 5))
const DEFAULT_BREAKER_COOLDOWN_MS = Math.max(1000, Number(process.env.JULIA_SHADOW_BREAKER_COOLDOWN_MS || 60000))
const DEFAULT_LOG_FILE = process.env.JULIA_SHADOW_LOG || '.data/julia-shadow.jsonl'

// Tarefa real -> intenção do player loop, só onde a correspondência é
// inequívoca. Fora daqui `agreesWithReal` fica `null` (não fabricamos).
const REAL_TASK_INTENT = {
  voltar: 'return_base',
  guardar: 'store_items',
  comer: 'find_food'
}

function realIntentFor(executedChoice, candidates) {
  const ids = new Set(candidates.map((c) => c.id))
  const mapped = REAL_TASK_INTENT[executedChoice]
  if (mapped && ids.has(mapped)) return mapped
  // Qualquer outra tarefa é o próprio objetivo em andamento.
  return ids.has('continue_objective') && !mapped ? 'continue_objective' : null
}

// Campos derivados, todos calculados offline sobre o estado já capturado.
function derive({ state, candidates, choice, executedChoice, objective, meta }) {
  const ids = candidates.map((c) => c.id)
  let rulesChoice = null
  try { rulesChoice = deterministicPlayerPolicy(state, candidates) } catch { /* só diagnóstico */ }

  let wouldViolateSafety = null
  if (choice) {
    try { wouldViolateSafety = Boolean(applyIntent(state, choice, {}).result?.safetyViolation) } catch { wouldViolateSafety = null }
  }

  const realIntent = realIntentFor(executedChoice, candidates)
  const safetyCritical = Boolean(state?.threat)
  const wouldAbandon = choice === 'stop_task'
  return {
    candidateIds: ids,
    rulesChoice,
    agreesWithRules: choice ? choice === rulesChoice : null,
    realIntent,
    agreesWithReal: choice && realIntent ? choice === realIntent : null,
    safetyCritical,
    // Sob ameaça o reflexo determinístico do runtime é quem age; se a Julia
    // divergiria das regras nesse momento, o guardrail prevalece.
    safetyOverride: safetyCritical && Boolean(choice) && choice !== rulesChoice,
    wouldViolateSafety,
    wouldAbandonObjective: wouldAbandon,
    unjustifiedAbandon: wouldAbandon && ids.some((id) => id !== 'stop_task'),
    objectiveType: objective?.type || null,
    resumedObjective: meta?.resumed ?? null
  }
}

class JuliaShadowObserver extends LayaShadowObserver {
  constructor({
    endpoint = process.env.JULIA_PLAYER_LOOP_URL || null,
    enabled = process.env.MBOT_JULIA_SHADOW === '1',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    breakerThreshold = DEFAULT_BREAKER_THRESHOLD,
    breakerCooldownMs = DEFAULT_BREAKER_COOLDOWN_MS,
    logFile = DEFAULT_LOG_FILE,
    ...rest
  } = {}) {
    super({ endpoint, enabled, timeoutMs, maxConcurrent, breakerThreshold, breakerCooldownMs, logFile, ...rest })
  }

  _finish({ id, decidedAt, state, objective, candidates, executedChoice, layaOutcome: outcome, resultOutcome, nextStateProvider, meta }) {
    if (outcome?.choice) this.stats.completed++
    else this.stats.failed++

    let nextState = null
    let interrupted = null
    try { if (typeof nextStateProvider === 'function') nextState = nextStateProvider() } catch (error) {
      this._safeLog(`nextStateProvider falhou: ${error?.message || error}`)
    }
    try { if (typeof meta?.interruptedCheck === 'function') interrupted = Boolean(meta.interruptedCheck()) } catch { interrupted = null }

    let derived = {}
    try {
      derived = derive({ state, candidates, choice: outcome?.choice || null, executedChoice, objective, meta })
    } catch (error) {
      this._safeLog(`falha ao derivar métricas: ${error?.message || error}`)
    }

    const row = {
      decisionId: id,
      decidedAt: new Date(decidedAt).toISOString(),
      state,
      objective: objective || null,
      candidates: candidates.map((c) => c.id),
      executedChoice: executedChoice ?? null,
      juliaChoice: outcome?.choice || null,
      juliaAttemptedChoice: outcome?.attemptedChoice || null,
      juliaConfidence: outcome?.confidence ?? null,
      juliaError: outcome?.error || null,
      latencyMs: Number.isFinite(outcome?.latency_ms) ? Math.round(outcome.latency_ms) : null,
      ...derived,
      result: resultOutcome.settled === 'resolved' ? (resultOutcome.value ?? null) : { ok: false, error: resultOutcome.error },
      nextState,
      interrupted,
      executionAuthority: 'none'
    }
    try {
      this.eventLog.log('julia_shadow_decision', row, meta?.worker || null)
    } catch (error) {
      this._safeLog(`falha ao gravar decisão do shadow mode: ${error?.message || error}`)
    }
  }

  _safeLog(message) {
    try { this.logger.log(`[julia-shadow] ${message}`) } catch { /* nunca derruba o runtime */ }
  }

  _logSkip(reason, meta) {
    try { this.eventLog.log('julia_shadow_skip', { reason }, meta?.worker || null) } catch (error) {
      this._safeLog(`falha ao registrar descarte: ${error?.message || error}`)
    }
  }
}

module.exports = { JuliaShadowObserver, derive }
