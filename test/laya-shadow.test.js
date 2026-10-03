const test = require('node:test')
const assert = require('node:assert/strict')
const { LayaShadowObserver } = require('../lib/laya-shadow')

const silentLogger = { log() {} }
const candidates = [
  { id: 'gather_materials', description: 'gather' },
  { id: 'continue_objective', description: 'continue' }
]

function fakeLog() {
  const calls = []
  return { calls, log: (type, data, worker) => { calls.push({ type, data, worker }); return data } }
}

// Espera as duas voltas de microtask usadas por observe() (fetch resolvido +
// resultPromise resolvida) sem depender de temporizadores reais.
async function flush(times = 8) {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setImmediate(resolve))
}

test('desabilitado por padrão: observe() não faz nada e não lança', () => {
  const eventLog = fakeLog()
  const observer = new LayaShadowObserver({ eventLog, logger: silentLogger })
  assert.equal(observer.enabled(), false)
  const result = observer.observe({
    state: {}, candidates, executedChoice: 'x', resultPromise: Promise.resolve({ ok: true })
  })
  assert.equal(result, undefined)
  assert.deepEqual(eventLog.calls, [])
})

test('habilitado sem endpoint continua desabilitado', () => {
  const eventLog = fakeLog()
  const observer = new LayaShadowObserver({ enabled: true, endpoint: null, eventLog, logger: silentLogger })
  assert.equal(observer.enabled(), false)
})

test('menos de 2 candidatos: nada a observar, não chama a rede', async () => {
  const eventLog = fakeLog()
  let calledFetch = false
  const observer = new LayaShadowObserver({
    enabled: true,
    endpoint: 'http://local/choose',
    eventLog,
    logger: silentLogger,
    fetchImpl: async () => { calledFetch = true; return { ok: true, json: async () => ({}) } }
  })
  observer.observe({ state: {}, candidates: [candidates[0]], executedChoice: 'x', resultPromise: Promise.resolve({ ok: true }) })
  await flush()
  assert.equal(calledFetch, false)
  assert.deepEqual(eventLog.calls, [])
})

test('decisão bem-sucedida é registrada com o formato esperado, sem afetar o chamador', async () => {
  const eventLog = fakeLog()
  const observer = new LayaShadowObserver({
    enabled: true,
    endpoint: 'http://local/choose',
    eventLog,
    logger: silentLogger,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choice: 'gather_materials', confidence: 0.8 })
    })
  })

  const resultPromise = Promise.resolve({ ok: true, gathered: 3 })
  const returned = observer.observe({
    state: { health: 20 },
    objective: { type: 'coletar_blocos' },
    candidates,
    executedChoice: 'coletar_blocos',
    resultPromise,
    nextStateProvider: () => ({ health: 20, food: 19 }),
    meta: { worker: 'lenhador_01', interruptedCheck: () => false }
  })
  assert.equal(returned, undefined) // nunca retorna nada usável pelo chamador

  await flush()
  // o resultado real do chamador continua intocado e consumível normalmente
  assert.deepEqual(await resultPromise, { ok: true, gathered: 3 })

  assert.equal(eventLog.calls.length, 1)
  const { type, data, worker } = eventLog.calls[0]
  assert.equal(type, 'laya_shadow_decision')
  assert.equal(worker, 'lenhador_01')
  assert.equal(data.layaChoice, 'gather_materials')
  assert.equal(data.layaConfidence, 0.8)
  assert.equal(data.layaError, null)
  assert.equal(data.executedChoice, 'coletar_blocos')
  assert.deepEqual(data.candidates, ['gather_materials', 'continue_objective'])
  assert.deepEqual(data.result, { ok: true, gathered: 3 })
  assert.deepEqual(data.nextState, { health: 20, food: 19 })
  assert.equal(data.interrupted, false)
  assert.equal(observer.getStats().completed, 1)
})

test('escolha do Laya fora dos candidatos vira invalid_choice, nunca é executada', async () => {
  const eventLog = fakeLog()
  const observer = new LayaShadowObserver({
    enabled: true,
    endpoint: 'http://local/choose',
    eventLog,
    logger: silentLogger,
    fetchImpl: async () => ({ ok: true, json: async () => ({ choice: 'fly_away', confidence: 0.9 }) })
  })
  observer.observe({ state: {}, candidates, executedChoice: 'continue_objective', resultPromise: Promise.resolve({ ok: true }) })
  await flush()
  assert.equal(eventLog.calls[0].data.layaChoice, null)
  assert.equal(eventLog.calls[0].data.layaAttemptedChoice, 'fly_away')
  assert.equal(eventLog.calls[0].data.layaError, 'invalid_choice')
  assert.equal(observer.getStats().invalidChoice, 1)
})

test('resposta malformada (sem choice) é rejeitada sem derrubar nada', async () => {
  const eventLog = fakeLog()
  const observer = new LayaShadowObserver({
    enabled: true,
    endpoint: 'http://local/choose',
    eventLog,
    logger: silentLogger,
    fetchImpl: async () => ({ ok: true, json: async () => ({}) })
  })
  observer.observe({ state: {}, candidates, executedChoice: 'x', resultPromise: Promise.resolve({ ok: true }) })
  await flush()
  assert.equal(eventLog.calls[0].data.layaError, 'malformed_response')
})

test('erro HTTP do sidecar vira registro de falha, não lança', async () => {
  const eventLog = fakeLog()
  const observer = new LayaShadowObserver({
    enabled: true,
    endpoint: 'http://local/choose',
    eventLog,
    logger: silentLogger,
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) })
  })
  observer.observe({ state: {}, candidates, executedChoice: 'x', resultPromise: Promise.resolve({ ok: true }) })
  await flush()
  assert.equal(eventLog.calls[0].data.layaError, 'http_500')
  assert.equal(observer.getStats().failed, 1)
})

test('timeout aborta a chamada e é registrado como timeout', async () => {
  const eventLog = fakeLog()
  const observer = new LayaShadowObserver({
    enabled: true,
    endpoint: 'http://local/choose',
    timeoutMs: 5,
    eventLog,
    logger: silentLogger,
    fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
  })
  observer.observe({ state: {}, candidates, executedChoice: 'x', resultPromise: Promise.resolve({ ok: true }) })
  await new Promise((resolve) => setTimeout(resolve, 30))
  await flush()
  assert.equal(eventLog.calls[0].data.layaError, 'timeout')
})

test('crash/exceção do fetch (sidecar fora do ar) não escapa do observer', async () => {
  const eventLog = fakeLog()
  const observer = new LayaShadowObserver({
    enabled: true,
    endpoint: 'http://local/choose',
    eventLog,
    logger: silentLogger,
    fetchImpl: async () => { throw new Error('ECONNREFUSED') }
  })
  observer.observe({ state: {}, candidates, executedChoice: 'x', resultPromise: Promise.resolve({ ok: true }) })
  await flush()
  assert.equal(eventLog.calls[0].data.layaError, 'ECONNREFUSED')
})

test('concorrência é limitada: chamada além de maxConcurrent é descartada, não enfileirada', async () => {
  const eventLog = fakeLog()
  let inFlightFetches = 0
  let maxObservedInFlight = 0
  let releaseFirst
  const firstGate = new Promise((resolve) => { releaseFirst = resolve })

  const observer = new LayaShadowObserver({
    enabled: true,
    endpoint: 'http://local/choose',
    maxConcurrent: 1,
    eventLog,
    logger: silentLogger,
    fetchImpl: async () => {
      inFlightFetches++
      maxObservedInFlight = Math.max(maxObservedInFlight, inFlightFetches)
      await firstGate
      inFlightFetches--
      return { ok: true, json: async () => ({ choice: 'gather_materials' }) }
    }
  })

  observer.observe({ state: {}, candidates, executedChoice: 'a', resultPromise: Promise.resolve({ ok: true }) })
  observer.observe({ state: {}, candidates, executedChoice: 'b', resultPromise: Promise.resolve({ ok: true }) })
  observer.observe({ state: {}, candidates, executedChoice: 'c', resultPromise: Promise.resolve({ ok: true }) })
  await flush()
  releaseFirst()
  await flush()

  assert.equal(maxObservedInFlight, 1)
  assert.equal(observer.getStats().skippedConcurrency, 2)
  const decisions = eventLog.calls.filter((c) => c.type === 'laya_shadow_decision')
  const skips = eventLog.calls.filter((c) => c.type === 'laya_shadow_skip')
  assert.equal(decisions.length, 1) // só a primeira decisão foi observada de verdade
  assert.equal(skips.length, 2) // as outras duas ficam registradas como descarte, não como se nunca tivessem existido
  assert.ok(skips.every((s) => s.data.reason === 'max_concurrency'))
})

test('disjuntor abre depois de falhas seguidas e para de chamar a rede', async () => {
  const eventLog = fakeLog()
  let fetchCalls = 0
  const observer = new LayaShadowObserver({
    enabled: true,
    endpoint: 'http://local/choose',
    breakerThreshold: 2,
    breakerCooldownMs: 60000,
    eventLog,
    logger: silentLogger,
    fetchImpl: async () => { fetchCalls++; return { ok: false, status: 500, json: async () => ({}) } }
  })

  for (let i = 0; i < 4; i++) {
    observer.observe({ state: {}, candidates, executedChoice: 'x', resultPromise: Promise.resolve({ ok: true }) })
    await flush()
  }

  assert.equal(fetchCalls, 2) // o disjuntor abre na 2ª falha e evita as próximas
  assert.equal(observer.getStats().breakerOpen, true)
  const skips = eventLog.calls.filter((c) => c.type === 'laya_shadow_skip' && c.data.reason === 'breaker_open')
  assert.equal(skips.length, 2) // as 2 tentativas bloqueadas pelo disjuntor também ficam visíveis no log
})

test('resultPromise rejeitada é registrada como falha, sem lançar e sem afetar quem mais consome a promise', async () => {
  const eventLog = fakeLog()
  const observer = new LayaShadowObserver({
    enabled: true,
    endpoint: 'http://local/choose',
    eventLog,
    logger: silentLogger,
    fetchImpl: async () => ({ ok: true, json: async () => ({ choice: 'gather_materials' }) })
  })

  const resultPromise = Promise.reject(new Error('caiu'))
  observer.observe({ state: {}, candidates, executedChoice: 'x', resultPromise })
  await flush()

  // o chamador ainda consegue tratar a rejeição normalmente depois
  await assert.rejects(resultPromise, /caiu/)
  assert.equal(eventLog.calls[0].data.result.ok, false)
  assert.match(eventLog.calls[0].data.result.error, /caiu/)
})

test('falha ao registrar no log não escapa do observer', async () => {
  const observer = new LayaShadowObserver({
    enabled: true,
    endpoint: 'http://local/choose',
    eventLog: { log() { throw new Error('disco cheio') } },
    logger: silentLogger,
    fetchImpl: async () => ({ ok: true, json: async () => ({ choice: 'gather_materials' }) })
  })
  observer.observe({ state: {}, candidates, executedChoice: 'x', resultPromise: Promise.resolve({ ok: true }) })
  await flush() // não deve lançar nem gerar rejeição não tratada
})
