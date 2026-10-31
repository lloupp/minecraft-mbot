const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { Vec3 } = require('vec3')

const { envPort, candidatePorts, findServer } = require('../app/discovery')
const { createCompanion } = require('../app/companion')
const { createPersistence } = require('../app/persistence')
const { ensureProjectWorkers } = require('../app/workers')
const { createLifecycle } = require('../app/lifecycle')
const { Memory } = require('../core/Memory')

test('envPort aceita só portas TCP válidas', () => {
  assert.equal(envPort('25565'), 25565)
  assert.equal(envPort('0'), null)
  assert.equal(envPort('70000'), null)
  assert.equal(envPort('abc'), null)
})

test('candidatePorts: porta explícita, senão locais + 25565, sem repetir', () => {
  assert.deepEqual(candidatePorts({ port: 4000 }, () => [1]), [4000])
  assert.deepEqual(candidatePorts({ local: true }, () => [5000, 25565]), [5000, 25565])
  assert.deepEqual(candidatePorts({ local: false }, () => [5000]), [25565])
})

test('findServer devolve o primeiro que responde ao ping', async () => {
  const pinged = []
  const server = await findServer({ host: 'h', local: true }, {
    localPorts: () => [1111, 2222],
    ping: async (host, port) => { pinged.push(`${host}:${port}`); return port === 2222 ? { port, version: '1.20.1' } : null }
  })
  assert.deepEqual(server, { port: 2222, version: '1.20.1' })
  assert.deepEqual(pinged, ['h:1111', 'h:2222'])
  assert.equal(await findServer({ host: 'h', port: 9 }, { ping: async () => null }), null)
})

function companionBot() {
  const bot = new EventEmitter()
  Object.assign(bot, {
    username: 'eduardo_bot',
    said: [],
    chat(text) { this.said.push(text) },
    players: { dono: { entity: { position: new Vec3(0, 64, 0) } } },
    entity: { position: new Vec3(0, 64, 0) },
    pathfinder: { goal: null, setGoal(goal) { this.goal = goal }, setMovements() {} }
  })
  return bot
}

function companionFor(bot) {
  const places = { assertWaypointReachable: () => {}, placeLabel: (e) => e.name }
  return createCompanion({ bot, memory: new Memory({ autoSave: false }), botManager: { get: () => null }, places })
}

test('ownerName: usa o dono configurado, senão o primeiro jogador que não é bot', () => {
  const bot = companionBot()
  assert.equal(companionFor(bot).ownerName(), 'dono')
  const configured = createCompanion({ bot, memory: new Memory({ autoSave: false }), botManager: { get: () => null }, places: {}, owner: 'outro' })
  assert.equal(configured.ownerName(), 'outro')
})

test('runTask: uma tarefa nova cancela a anterior e o fim volta a seguir', async () => {
  const bot = companionBot()
  const companion = companionFor(bot)
  let firstCancelled = null
  let releaseFirst
  const first = companion.runTask('primeira', async (isCancelled) => {
    await new Promise((resolve) => { releaseFirst = resolve })
    firstCancelled = isCancelled()
  })
  assert.equal(companion.mode, 'tarefa')
  assert.equal(companion.taskName, 'primeira')
  const second = companion.runTask('segunda', async () => {})
  releaseFirst()
  await Promise.all([first, second])
  assert.equal(firstCancelled, true)
  assert.equal(companion.mode, 'seguir')
  assert.equal(companion.taskName, null)
})

test('runTask: erro vira mensagem no chat, sem lançar', async () => {
  const bot = companionBot()
  const companion = companionFor(bot)
  await companion.runTask('cavar', async () => { throw new Error('sem picareta') })
  assert.deepEqual(bot.said, ['Não consegui cavar: sem picareta'])
  assert.equal(companion.mode, 'seguir')
})

test('withoutFollowing pausa o seguir e só volta quando a última chamada termina', async () => {
  const companion = companionFor(companionBot())
  let release
  const outer = companion.withoutFollowing('ler o estoque', () => new Promise((resolve) => { release = resolve }))
  assert.equal(companion.mode, 'tarefa')
  await companion.withoutFollowing('ler o estoque', async () => {})
  assert.equal(companion.mode, 'tarefa')
  release()
  await outer
  assert.equal(companion.mode, 'seguir')
})

test('persistence: debounce agrupa salvamentos e lê o autônomo na hora', async () => {
  const saved = []
  let auto = false
  const persistence = createPersistence({
    stateStore: { save: async (state) => saved.push(state) },
    storage: { getPosition: () => null },
    colony: { auto: true, animalTargetsSnapshot: () => ({}) },
    waypointManager: { exportState: () => ({}) },
    botManager: { rosterCounts: () => ({ minerador: 2 }) },
    projectManager: { exportState: () => null },
    companionAuto: () => auto
  })
  persistence.persistSoon()
  auto = true
  persistence.persistSoon()
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(saved.length, 1)
  assert.equal(saved[0].companionAuto, true)
  assert.deepEqual(saved[0].workers, { minerador: 2 })
})

test('ensureProjectWorkers cria só o que falta e respeita a capacidade', async () => {
  const created = []
  const botManager = {
    byRole: (role) => (role === 'construtor' ? [{}] : []),
    capacity: () => 3,
    create: async (role, n) => { created.push([role, n]); return Array.from({ length: n }, (_, i) => ({ name: `${role}${i}` })) }
  }
  const projectManager = { definition: () => ({ requiredRoles: { construtor: 2, minerador: 1 } }) }
  assert.deepEqual(await ensureProjectWorkers({ projectManager, botManager }, 'casa'), ['construtor0', 'minerador0'])
  assert.deepEqual(created, [['construtor', 1], ['minerador', 1]])
  await assert.rejects(ensureProjectWorkers({ projectManager, botManager: { ...botManager, capacity: () => 1 } }, 'casa'), /capacidade para 1/)
  await assert.rejects(ensureProjectWorkers({ projectManager: { definition: () => null }, botManager }, 'x'), /projeto desconhecido/)
})

test('lifecycle: requestQuit marca saída limpa', () => {
  const lifecycle = createLifecycle()
  assert.equal(lifecycle.quitRequested, false)
  lifecycle.requestQuit()
  assert.equal(lifecycle.quitRequested, true)
})
