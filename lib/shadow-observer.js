// lib/shadow-observer.js
// Base do shadow mode assíncrono: observa decisões reais em paralelo, sem
// nunca influenciar a execução. `observe()` nunca é `await`ado pelo chamador
// e nunca lança para ele — dispara o trabalho e some. Usado pela Julia-1
// (lib/julia-shadow.js); a subclasse implementa `_finish`, `_safeLog` e
// `_logSkip` (o que é registrado e onde).
//
// Garantias de design (não dependem de configuração para valer):
// - o valor de retorno de `observe()` é sempre `undefined`; nada que ele
//   calcule chega de volta ao chamador, então não há como o modelo "vencer" e
//   virar a ação executada;
// - no máximo `maxConcurrent` chamadas ao modelo em voo ao mesmo tempo; acima
//   disso a observação é descartada (nunca enfileirada) para não acumular;
// - um disjuntor para de tentar por `breakerCooldownMs` depois de
//   `breakerThreshold` falhas seguidas (sidecar fora do ar não vira um
//   martelo de requisições nem um log cheio de timeouts repetidos);
// - o log é o `EventLog` já usado pelo resto da colônia: tamanho e nº de
//   linhas limitados, por padrão em arquivo separado do log principal.

const { EventLog } = require('./event-log')

class ShadowObserver {
  constructor({
    endpoint = null,
    enabled = false,
    timeoutMs = 3000,
    maxConcurrent = 1,
    breakerThreshold = 5,
    breakerCooldownMs = 60000,
    eventLog = null,
    logFile = '.data/shadow.jsonl',
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
  // - state/objective/candidates: o que o modelo vê (candidates precisa de
  //   >= 2 opções; com 0 ou 1 não há decisão real a observar).
  // - executedChoice: o que o sistema real já decidiu fazer, independente
  //   do modelo (pode não estar no mesmo vocabulário dos `candidates`).
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
      // disponibilidade em scripts/julia-shadow-report.js não ficar cega a
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

      const modelPromise = this._callModel(state, candidates).finally(() => { this.inFlight-- })
      const safeResult = Promise.resolve(resultPromise).then(
        (value) => ({ settled: 'resolved', value }),
        (error) => ({ settled: 'rejected', error: error?.message || String(error) })
      )

      Promise.allSettled([modelPromise, safeResult])
        .then(([modelSettled, resultSettled]) => {
          const outcome = modelSettled.status === 'fulfilled'
            ? modelSettled.value
            : { error: modelSettled.reason?.message || String(modelSettled.reason) }
          const resultOutcome = resultSettled.status === 'fulfilled'
            ? resultSettled.value
            : { settled: 'rejected', error: 'result_promise_handler_failed' }
          this._finish({ id, decidedAt, state, objective, candidates, executedChoice, outcome, resultOutcome, nextStateProvider, meta })
        })
        .catch((error) => this._safeLog(`erro interno ao registrar decisão: ${error?.message || error}`))
    } catch (error) {
      this._safeLog(`erro síncrono em observe(): ${error?.message || error}`)
    }
  }

  async _callModel(state, candidates) {
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

  getStats() {
    return { ...this.stats, inFlight: this.inFlight, breakerOpen: this.now() < this.breakerOpenUntil }
  }
}

module.exports = { ShadowObserver }
