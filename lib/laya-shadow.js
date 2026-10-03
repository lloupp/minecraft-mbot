// lib/laya-shadow.js
// Shadow mode assíncrono do Laya: observa decisões reais em paralelo, sem
// nunca influenciar a execução. `observe()` nunca é `await`ado pelo chamador
// e nunca lança para ele — dispara o trabalho e some.
//
// Garantias de design (não dependem de configuração para valer):
// - o valor de retorno de `observe()` é sempre `undefined`; nada que ele
//   calcule chega de volta ao chamador, então não há como o Laya "vencer" e
//   virar a ação executada;
// - no máximo `maxConcurrent` chamadas ao Laya em voo ao mesmo tempo; acima
//   disso a observação é descartada (nunca enfileirada) para não acumular;
// - um disjuntor para de tentar por `breakerCooldownMs` depois de
//   `breakerThreshold` falhas seguidas (sidecar fora do ar não vira um
//   martelo de requisições nem um log cheio de timeouts repetidos);
// - o log é o `EventLog` já usado pelo resto da colônia: tamanho e nº de
//   linhas limitados, por padrão em arquivo separado do log principal.

const { EventLog } = require('./event-log')

const DEFAULT_TIMEOUT_MS = Number(process.env.LAYA_SHADOW_TIMEOUT_MS || 3000)
const DEFAULT_MAX_CONCURRENT = Math.max(1, Number(process.env.LAYA_SHADOW_MAX_CONCURRENT || 1))
const DEFAULT_BREAKER_THRESHOLD = Math.max(1, Number(process.env.LAYA_SHADOW_BREAKER_THRESHOLD || 5))
const DEFAULT_BREAKER_COOLDOWN_MS = Math.max(1000, Number(process.env.LAYA_SHADOW_BREAKER_COOLDOWN_MS || 60000))
const DEFAULT_LOG_FILE = process.env.LAYA_SHADOW_LOG || '.data/laya-shadow.jsonl'

function isEnabledByEnv() {
  return process.env.MBOT_LAYA_SHADOW === '1'
}

class LayaShadowObserver {
  constructor({
    endpoint = process.env.LAYA_PLAYER_LOOP_URL || null,
    enabled = isEnabledByEnv(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
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
    this.maxConcurrent = maxConcurrent
    this.breakerThreshold = breakerThreshold
    this.breakerCooldownMs = breakerCooldownMs
    this.eventLog = eventLog || new EventLog(logFile)
    this.fetch = fetchImpl
    this.logger = logger
    this.now = now

    this.inFlight = 0
    this.seq = 0
    this.consecutiveFailures = 0
    this.breakerOpenUntil = 0
    this.stats = {
      observed: 0,
      skippedConcurrency: 0,
      skippedBreaker: 0,
      completed: 0,
      failed: 0,
      invalidChoice: 0
    }
  }

  enabled() {
    return this._enabled && Boolean(this.endpoint)
  }

  // Ponto de entrada. Síncrono na prática: agenda o trabalho e retorna
  // imediatamente. Nunca lança — qualquer erro interno vira um log e some.
  //
  // - state/objective/candidates: o que o Laya vê (candidates precisa de
  //   >= 2 opções; com 0 ou 1 não há decisão real a observar).
  // - executedChoice: o que o sistema real já decidiu fazer, independente
  //   do Laya (pode não estar no mesmo vocabulário dos `candidates` — ver
  //   docs/LAYA_SHADOW_MODE.md).
  // - resultPromise: a promise real da tarefa em execução. O observer só a
  //   lê (com `.then`), nunca a substitui nem interfere em quem mais a
  //   consome.
  // - nextStateProvider: função síncrona opcional, chamada quando
  //   `resultPromise` se resolve, para capturar um novo retrato do estado.
  // - meta: { worker, interruptedCheck } opcionais, só para o registro.
  observe({ state, objective, candidates, executedChoice, resultPromise, nextStateProvider, meta } = {}) {
    try {
      if (!this.enabled()) return
      if (!Array.isArray(candidates) || candidates.length < 2) return
      // Descartes são registrados (leve, sem chamada de rede) para a
      // disponibilidade em scripts/laya-shadow-report.js não ficar cega a
      // eles — sem isto, um disjuntor aberto por muito tempo pareceria
      // 100% disponível só porque nada foi tentado.
      if (this.now() < this.breakerOpenUntil) {
        this.stats.skippedBreaker++
        this._logSkip('breaker_open', meta)
        return
      }
      if (this.inFlight >= this.maxConcurrent) {
        this.stats.skippedConcurrency++
        this._logSkip('max_concurrency', meta)
        return
      }

      this.inFlight++
      this.stats.observed++
      const id = ++this.seq
      const decidedAt = this.now()

      const layaPromise = this._callLaya(state, candidates).finally(() => { this.inFlight-- })
      const safeResult = Promise.resolve(resultPromise).then(
        (value) => ({ settled: 'resolved', value }),
        (error) => ({ settled: 'rejected', error: error?.message || String(error) })
      )

      Promise.allSettled([layaPromise, safeResult])
        .then(([layaSettled, resultSettled]) => {
          const layaOutcome = layaSettled.status === 'fulfilled'
            ? layaSettled.value
            : { error: layaSettled.reason?.message || String(layaSettled.reason) }
          const resultOutcome = resultSettled.status === 'fulfilled'
            ? resultSettled.value
            : { settled: 'rejected', error: 'result_promise_handler_failed' }
          this._finish({ id, decidedAt, state, objective, candidates, executedChoice, layaOutcome, resultOutcome, nextStateProvider, meta })
        })
        .catch((error) => this._safeLog(`erro interno ao registrar decisão: ${error?.message || error}`))
    } catch (error) {
      this._safeLog(`erro síncrono em observe(): ${error?.message || error}`)
    }
  }

  async _callLaya(state, candidates) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    const started = this.now()
    try {
      const response = await this.fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          state,
          candidates: candidates.map((c) => ({ id: c.id, description: c.description }))
        }),
        signal: controller.signal
      })
      const latency_ms = this.now() - started
      if (!response.ok) {
        this._onFailure()
        return { error: `http_${response.status}`, latency_ms }
      }
      const value = await response.json()
      if (!value || typeof value.choice !== 'string') {
        this._onFailure()
        return { error: 'malformed_response', latency_ms }
      }
      if (!candidates.some((c) => c.id === value.choice)) {
        this._onFailure()
        this.stats.invalidChoice++
        return { error: 'invalid_choice', attemptedChoice: value.choice, latency_ms }
      }
      this._onSuccess()
      return {
        choice: value.choice,
        confidence: Number.isFinite(Number(value.confidence)) ? Number(value.confidence) : null,
        latency_ms
      }
    } catch (error) {
      this._onFailure()
      return {
        error: error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error)),
        latency_ms: this.now() - started
      }
    } finally {
      clearTimeout(timer)
    }
  }

  _onSuccess() {
    this.consecutiveFailures = 0
  }

  _onFailure() {
    this.consecutiveFailures++
    if (this.consecutiveFailures >= this.breakerThreshold) {
      this.breakerOpenUntil = this.now() + this.breakerCooldownMs
      this.consecutiveFailures = 0
    }
  }

  _finish({ id, decidedAt, state, objective, candidates, executedChoice, layaOutcome, resultOutcome, nextStateProvider, meta }) {
    if (layaOutcome?.choice) this.stats.completed++
    else this.stats.failed++

    let nextState = null
    let interrupted = null
    try {
      if (typeof nextStateProvider === 'function') nextState = nextStateProvider()
    } catch (error) {
      this._safeLog(`nextStateProvider falhou: ${error?.message || error}`)
    }
    try {
      if (typeof meta?.interruptedCheck === 'function') interrupted = Boolean(meta.interruptedCheck())
    } catch {
      interrupted = null
    }

    const row = {
      decisionId: id,
      decidedAt: new Date(decidedAt).toISOString(),
      state,
      objective: objective || null,
      candidates: candidates.map((c) => c.id),
      layaChoice: layaOutcome.choice || null,
      layaAttemptedChoice: layaOutcome.attemptedChoice || null,
      layaConfidence: layaOutcome.confidence ?? null,
      layaError: layaOutcome.error || null,
      latencyMs: Number.isFinite(layaOutcome.latency_ms) ? Math.round(layaOutcome.latency_ms) : null,
      executedChoice: executedChoice ?? null,
      result: resultOutcome.settled === 'resolved' ? (resultOutcome.value ?? null) : { ok: false, error: resultOutcome.error },
      nextState,
      interrupted
    }

    try {
      this.eventLog.log('laya_shadow_decision', row, meta?.worker || null)
    } catch (error) {
      this._safeLog(`falha ao gravar decisão do shadow mode: ${error?.message || error}`)
    }
  }

  _safeLog(message) {
    try { this.logger.log(`[laya-shadow] ${message}`) } catch { /* nunca deixa o log derrubar o runtime */ }
  }

  _logSkip(reason, meta) {
    try {
      this.eventLog.log('laya_shadow_skip', { reason }, meta?.worker || null)
    } catch (error) {
      this._safeLog(`falha ao registrar descarte: ${error?.message || error}`)
    }
  }

  getStats() {
    return { ...this.stats, inFlight: this.inFlight, breakerOpen: this.now() < this.breakerOpenUntil }
  }
}

module.exports = { LayaShadowObserver }
