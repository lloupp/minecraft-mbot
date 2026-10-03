const test = require('node:test')
const assert = require('node:assert/strict')
const { JuliaShadowObserver, derive } = require('../lib/julia-shadow')
const { combineShadows } = require('../lib/shadow-fanout')

const silent = { log() {} }
const candidates = [
  { id: 'gather_materials', description: 'gather' },
  { id: 'continue_objective', description: 'continue' }
]
const fakeLog = () => { const calls = []; return { calls, log: (type, data, worker) => calls.push({ type, data, worker }) } }
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)) }
const make = (extra) => new JuliaShadowObserver({ enabled: true, endpoint: 'http://local/choose', logger: silent, ...extra })

test('desabilitado por padrão e sem endpoint', () => {
  assert.equal(new JuliaShadowObserver({ logger: silent, eventLog: fakeLog() }).enabled(), false)
  assert.equal(new JuliaShadowObserver({ enabled: true, endpoint: null, logger: silent, eventLog: fakeLog() }).enabled(), false)
})

test('registra a decisão da Julia sem devolver nada ao chamador', async () => {
  const eventLog = fakeLog()
  const observer = make({
    eventLog,
    fetchImpl: async () => ({ ok: true, json: async () => ({ choice: 'gather_materials', confidence: 0.9 }) })
  })
  const returned = observer.observe({
    state: { health: 20, threat: null }, objective: { type: 'explore' }, candidates,
    executedChoice: 'explorar', resultPromise: Promise.resolve({ ok: true }),
    meta: { worker: 'w1', resumed: false, interruptedCheck: () => false }
  })
  assert.equal(returned, undefined)
  await flush()
  const [entry] = eventLog.calls
  assert.equal(entry.type, 'julia_shadow_decision')
  assert.equal(entry.worker, 'w1')
  const row = entry.data
  assert.equal(row.juliaChoice, 'gather_materials')
  assert.equal(row.juliaConfidence, 0.9)
  assert.equal(row.executedChoice, 'explorar')
  assert.deepEqual(row.candidates, ['gather_materials', 'continue_objective'])
  assert.equal(row.rulesChoice, 'gather_materials')
  assert.equal(row.agreesWithRules, true)
  assert.equal(row.agreesWithReal, false) // real = continue_objective
  assert.equal(row.resumedObjective, false)
  assert.equal(row.executionAuthority, 'none')
  assert.deepEqual(row.result, { ok: true })
})

test('timeout, erro HTTP e escolha fora da máscara viram registro, nunca exceção', async () => {
  const eventLog = fakeLog()
  const responses = [
    async () => { const e = new Error('abort'); e.name = 'AbortError'; throw e },
    async () => ({ ok: false, status: 503 }),
    async () => ({ ok: true, json: async () => ({ choice: 'delete_world' }) })
  ]
  for (const fetchImpl of responses) {
    const observer = make({ eventLog, fetchImpl })
    observer.observe({ state: {}, candidates, executedChoice: 'x', resultPromise: Promise.resolve({ ok: true }) })
    await flush()
  }
  assert.deepEqual(eventLog.calls.map((c) => c.data.juliaError), ['timeout', 'http_503', 'invalid_choice'])
  assert.ok(eventLog.calls.every((c) => c.data.juliaChoice === null))
  assert.equal(eventLog.calls[2].data.juliaAttemptedChoice, 'delete_world')
})

test('resultado real que falha é registrado sem propagar', async () => {
  const eventLog = fakeLog()
  const observer = make({ eventLog, fetchImpl: async () => ({ ok: true, json: async () => ({ choice: 'continue_objective' }) }) })
  observer.observe({ state: {}, candidates, executedChoice: 'x', resultPromise: Promise.reject(new Error('rota falhou')) })
  await flush()
  assert.deepEqual(eventLog.calls[0].data.result, { ok: false, error: 'rota falhou' })
})

test('derive: abandono, override de segurança e concordância', () => {
  const threatState = { threat: { type: 'zombie', distance: 3, count: 1 } }
  const cands = [{ id: 'escape_danger' }, { id: 'prepare_combat' }]
  const d = derive({ state: threatState, candidates: cands, choice: 'prepare_combat', executedChoice: 'explorar', objective: { type: 'explore' } })
  assert.equal(d.safetyCritical, true)
  assert.equal(d.safetyOverride, true)
  assert.equal(d.agreesWithRules, false)

  const stop = derive({ state: {}, candidates: [{ id: 'continue_objective' }, { id: 'stop_task' }], choice: 'stop_task', executedChoice: 'coletar_blocos' })
  assert.equal(stop.wouldAbandonObjective, true)
  assert.equal(stop.unjustifiedAbandon, true)

  const back = derive({ state: {}, candidates: [{ id: 'return_base' }, { id: 'continue_objective' }], choice: 'return_base', executedChoice: 'voltar' })
  assert.equal(back.agreesWithReal, true)
})

test('fan-out isola observadores e só usa os habilitados', () => {
  const seen = []
  const shadows = combineShadows(
    { enabled: () => false, observe: () => seen.push('off') },
    { enabled: () => true, observe: () => { throw new Error('boom') } },
    { enabled: () => true, observe: () => seen.push('on') }
  )
  assert.equal(shadows.enabled(), true)
  assert.equal(shadows.observe({}), undefined)
  assert.deepEqual(seen, ['on'])
  assert.equal(combineShadows({ enabled: () => false }).enabled(), false)
})
