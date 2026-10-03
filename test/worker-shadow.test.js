const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { Vec3 } = require('vec3')
const { WorkerController, shadowObjectiveKey } = require('../core/WorkerController')

const silent = { log: () => {} }

function fakeBot({ items = [] } = {}) {
  const bot = new EventEmitter()
  bot.entity = { position: new Vec3(0, 64, 0) }
  bot.health = 20
  bot.food = 20
  bot.entities = {}
  bot.inventory = { items: () => items }
  bot.nearestEntity = () => null
  bot.pathfinder = { setMovements: () => {}, setGoal: () => {} }
  return bot
}

function readyWorker(bot, extra = {}) {
  const worker = new WorkerController({ bot, name: 'minerador_01', role: 'minerador', logger: silent, ...extra })
  worker.workMoves = {}
  worker.state = 'ocioso'
  return worker
}

test('sem shadow configurado, run() se comporta exatamente como antes', async () => {
  const bot = fakeBot()
  const worker = readyWorker(bot)
  worker.explore = async () => ({ ok: true })
  const result = await worker.run({ type: 'explorar' })
  assert.deepEqual(result, { ok: true })
})

test('run() observa o shadow mode em paralelo, sem alterar o resultado real', async () => {
  // madeira + pedra dá para forjar uma espada de pedra: com objetivo "explore"
  // e sem arma equipada, candidateIntents oferece [prepare_combat, continue_objective].
  const bot = fakeBot({ items: [{ name: 'stick', count: 1 }, { name: 'cobblestone', count: 2 }] })
  const worker = readyWorker(bot, { homeProvider: () => null })
  worker.explore = async () => ({ ok: true, explored: 1 })

  const observed = []
  worker.shadow = { enabled: () => true, observe: (payload) => observed.push(payload) }

  const result = await worker.run({ type: 'explorar', radius: 8 })

  assert.deepEqual(result, { ok: true, explored: 1 })
  assert.equal(observed.length, 1)
  assert.equal(observed[0].executedChoice, 'explorar')
  assert.deepEqual(
    observed[0].candidates.map((c) => c.id).sort(),
    ['continue_objective', 'prepare_combat']
  )
  assert.equal(observed[0].objective.type, 'explorar')
  assert.equal(observed[0].meta.worker, 'minerador_01')
  assert.equal(typeof observed[0].meta.interruptedCheck, 'function')
  assert.equal(observed[0].meta.interruptedCheck(), false)
  assert.equal(typeof observed[0].nextStateProvider, 'function')
})

test('resultPromise passada ao shadow resolve para o mesmo valor que run() devolve ao chamador', async () => {
  // run() é `async`, então o que o chamador recebe é uma promise que adota o
  // resultado da promise interna — objetos diferentes, mesmo valor final.
  const bot = fakeBot({ items: [{ name: 'stick', count: 1 }, { name: 'cobblestone', count: 2 }] })
  const worker = readyWorker(bot, { homeProvider: () => null })
  worker.explore = async () => ({ ok: true, marker: 'unico' })

  let capturedPromise = null
  worker.shadow = { enabled: () => true, observe: (payload) => { capturedPromise = payload.resultPromise } }

  const result = await worker.run({ type: 'explorar' })
  assert.ok(capturedPromise, 'observe() deveria ter recebido uma resultPromise')
  assert.deepEqual(await capturedPromise, result)
})

test('candidatos com 1 opção só (nada a decidir) não chamam o shadow', async () => {
  const bot = fakeBot() // sem materiais: cai no ramo genérico com 1 candidato só
  const worker = readyWorker(bot, { homeProvider: () => null })
  worker.returnHome = async () => ({ ok: true })

  let called = false
  worker.shadow = { enabled: () => true, observe: () => { called = true } }
  await worker.run({ type: 'voltar' })
  assert.equal(called, false)
})

test('shadow desabilitado não é consultado', async () => {
  const bot = fakeBot({ items: [{ name: 'stick', count: 1 }, { name: 'cobblestone', count: 2 }] })
  const worker = readyWorker(bot, { homeProvider: () => null })
  worker.explore = async () => ({ ok: true })
  let called = false
  worker.shadow = { enabled: () => false, observe: () => { called = true } }
  await worker.run({ type: 'explorar' })
  assert.equal(called, false)
})

test('se o shadow lançar de forma síncrona, run() ainda devolve o resultado real', async () => {
  const bot = fakeBot({ items: [{ name: 'stick', count: 1 }, { name: 'cobblestone', count: 2 }] })
  const worker = readyWorker(bot, { homeProvider: () => null })
  worker.explore = async () => ({ ok: true, explored: 2 })
  worker.shadow = { enabled: () => true, observe: () => { throw new Error('sidecar explodiu') } }

  const result = await worker.run({ type: 'explorar' })
  assert.deepEqual(result, { ok: true, explored: 2 })
})

test('erro real da tarefa continua propagando normalmente com o shadow ativo', async () => {
  const bot = fakeBot({ items: [{ name: 'stick', count: 1 }, { name: 'cobblestone', count: 2 }] })
  const worker = readyWorker(bot, { homeProvider: () => null })
  worker.explore = async () => { throw new Error('falhou de verdade') }
  worker.shadow = { enabled: () => true, observe: () => {} }

  await assert.rejects(worker.run({ type: 'explorar' }), /falhou de verdade/)
})

test('_shadowFailureStreak conta falhas seguidas e zera no sucesso', async () => {
  const bot = fakeBot({ items: [{ name: 'stick', count: 1 }, { name: 'cobblestone', count: 2 }] })
  const worker = readyWorker(bot, { homeProvider: () => null })
  worker.shadow = { enabled: () => true, observe: () => {} }

  worker.explore = async () => { throw new Error('x') }
  await assert.rejects(worker.run({ type: 'explorar' }))
  await Promise.resolve()
  assert.equal(worker._shadowFailureStreak, 1)

  worker.explore = async () => { throw new Error('x') }
  await assert.rejects(worker.run({ type: 'explorar' }))
  await Promise.resolve()
  assert.equal(worker._shadowFailureStreak, 2)

  worker.explore = async () => ({ ok: true })
  await worker.run({ type: 'explorar' })
  await Promise.resolve()
  assert.equal(worker._shadowFailureStreak, 0)
})

test('meta.resumed marca a mesma tarefa reenviada enquanto a anterior ainda rodava', async () => {
  const bot = fakeBot({ items: [{ name: 'stick', count: 1 }, { name: 'cobblestone', count: 2 }] })
  const worker = readyWorker(bot, { homeProvider: () => null })
  const observed = []
  worker.shadow = { enabled: () => true, observe: (payload) => observed.push(payload.meta.resumed) }

  let release
  worker.explore = () => new Promise((resolve) => { release = () => resolve({ ok: true }) })
  const first = worker.run({ type: 'explorar', radius: 8 })
  await new Promise((resolve) => setImmediate(resolve))
  worker.explore = async () => ({ ok: true })
  const second = worker.run({ type: 'explorar', radius: 8 }) // interrompe a primeira
  await second
  release()
  await first
  const third = await worker.run({ type: 'explorar', radius: 8 }) // anterior terminou: não é retomada
  assert.deepEqual(third, { ok: true })
  assert.deepEqual(observed, [false, true, false])
})

test('meta.resumed também vale quando a tarefa foi cancelada e já terminou antes da reemissão', async () => {
  const bot = fakeBot({ items: [{ name: 'stick', count: 1 }, { name: 'cobblestone', count: 2 }] })
  const worker = readyWorker(bot, { homeProvider: () => null })
  const observed = []
  worker.shadow = { enabled: () => true, observe: (payload) => observed.push(payload.meta.resumed) }

  let release
  worker.explore = () => new Promise((resolve) => { release = () => resolve({ ok: false }) })
  const first = worker.run({ type: 'explorar', radius: 8 })
  await new Promise((resolve) => setImmediate(resolve))
  worker.cancel() // ex.: reflexo de combate interrompe a tarefa
  release()
  await first
  await Promise.resolve()
  worker.explore = async () => ({ ok: true })
  await worker.run({ type: 'explorar', radius: 8 })
  assert.deepEqual(observed, [false, true])
})


test('_shadowFailureStreak conta resultado resolvido ok:false não cancelado', async () => {
  const bot = fakeBot({ items: [{ name: 'stick', count: 1 }, { name: 'cobblestone', count: 2 }] })
  const worker = readyWorker(bot, { homeProvider: () => null })
  worker.shadow = { enabled: () => true, observe: () => {} }

  worker.explore = async () => ({ ok: false, code: 'PATH_FAILED' })
  await worker.run({ type: 'explorar' })
  await Promise.resolve()
  assert.equal(worker._shadowFailureStreak, 1)

  worker.explore = async () => ({ ok: false, code: 'PATH_FAILED' })
  await worker.run({ type: 'explorar' })
  await Promise.resolve()
  assert.equal(worker._shadowFailureStreak, 2)

  worker.explore = async () => ({ ok: true })
  await worker.run({ type: 'explorar' })
  await Promise.resolve()
  assert.equal(worker._shadowFailureStreak, 0)
})

test('_shadowFailureStreak mantém o valor em cancelamento resolvido', async () => {
  const bot = fakeBot({ items: [{ name: 'stick', count: 1 }, { name: 'cobblestone', count: 2 }] })
  const worker = readyWorker(bot, { homeProvider: () => null })
  worker.shadow = { enabled: () => true, observe: () => {} }
  const task = { type: 'explorar' }
  worker._shadowFailureKey = shadowObjectiveKey(task)
  worker._shadowFailureStreak = 2

  worker.explore = async () => ({ ok: false, cancelled: true, code: 'CANCELLED' })
  await worker.run(task)
  await Promise.resolve()
  assert.equal(worker._shadowFailureStreak, 2)
})

test('_shadowFailureStreak trata code CANCELLED sem flag como neutro', async () => {
  const bot = fakeBot({ items: [{ name: 'stick', count: 1 }, { name: 'cobblestone', count: 2 }] })
  const worker = readyWorker(bot, { homeProvider: () => null })
  worker.shadow = { enabled: () => true, observe: () => {} }
  const task = { type: 'explorar' }
  worker._shadowFailureKey = shadowObjectiveKey(task)
  worker._shadowFailureStreak = 2

  worker.explore = async () => ({ ok: false, code: 'CANCELLED' })
  await worker.run(task)
  await Promise.resolve()
  assert.equal(worker._shadowFailureStreak, 2)
})

test('_shadowFailureStreak zera ao trocar objetivo/alvo antes do snapshot', async () => {
  const bot = fakeBot({ items: [{ name: 'stick', count: 1 }, { name: 'cobblestone', count: 2 }] })
  const worker = readyWorker(bot, { homeProvider: () => null })
  const observed = []
  worker.shadow = { enabled: () => true, observe: (payload) => observed.push(payload.state.consecutiveFailures) }

  const oldTask = { type: 'explorar', center: { x: 0, y: 64, z: 0 } }
  worker._shadowFailureKey = shadowObjectiveKey(oldTask)
  worker._shadowFailureStreak = 3
  worker.explore = async () => ({ ok: true })

  await worker.run({ type: 'explorar', center: { x: 20, y: 64, z: 20 } })
  assert.equal(observed[0], 0)
})

test('resultado atrasado de tarefa antiga não altera streak da execução nova', async () => {
  const bot = fakeBot({ items: [{ name: 'stick', count: 1 }, { name: 'cobblestone', count: 2 }] })
  const worker = readyWorker(bot, { homeProvider: () => null })
  worker.shadow = { enabled: () => true, observe: () => {} }

  let releaseOld
  worker.explore = () => new Promise((resolve) => { releaseOld = () => resolve({ ok: true }) })
  const oldRun = worker.run({ type: 'explorar', center: { x: 0, y: 64, z: 0 } })
  await new Promise((resolve) => setImmediate(resolve))

  worker.explore = async () => ({ ok: false, code: 'PATH_FAILED' })
  await worker.run({ type: 'explorar', center: { x: 20, y: 64, z: 20 } })
  await Promise.resolve()
  assert.equal(worker._shadowFailureStreak, 1)

  releaseOld()
  await oldRun
  await Promise.resolve()
  assert.equal(worker._shadowFailureStreak, 1)
})

test('meta.resumed NÃO vale para o mesmo tipo com alvo diferente (linhagem usa a chave de objetivo)', async () => {
  const bot = fakeBot({ items: [{ name: 'stick', count: 1 }, { name: 'cobblestone', count: 2 }] })
  const worker = readyWorker(bot, { homeProvider: () => null })
  const observed = []
  worker.shadow = { enabled: () => true, observe: (payload) => observed.push([payload.meta.resumed, payload.meta.taskLineageId]) }
  let release
  worker.goToPoint = () => new Promise((resolve) => { release = () => resolve({ ok: true }) })
  const first = worker.run({ type: 'ir_local', position: { x: 10, y: 64, z: 0 } })
  await new Promise((resolve) => setImmediate(resolve))
  worker.goToPoint = async () => ({ ok: true })
  await worker.run({ type: 'ir_local', position: { x: -50, y: 64, z: 30 } }) // outro destino: tarefa nova
  release(); await first
  if (observed.length === 2) {
    assert.equal(observed[1][0], false)
    assert.notEqual(observed[0][1], observed[1][1])
  }
})

test('falha ao registrar linhagem nunca rejeita run() (fail-open)', async () => {
  const bot = fakeBot()
  const worker = readyWorker(bot)
  worker.shadow = { enabled: () => true, observe: () => {} }
  worker.goToPoint = async () => ({ ok: true })
  const hostile = {}
  Object.defineProperty(hostile, 'x', { get() { throw new Error('boom') }, enumerable: true })
  assert.deepEqual(await worker.run({ type: 'ir_local', position: hostile }), { ok: true }) // só shadowObjectiveKey lê hostile.x
})
