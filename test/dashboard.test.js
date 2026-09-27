// test/dashboard.test.js
// Painel de testes: rotas do StatusServer, ciclo de cenários do RunVerifier,
// retrato dos bots, buffer de console e binds do viewer/inventário.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')

const { EventLog } = require('../lib/event-log')
const { StatusServer } = require('../lib/status-server')
const { RunVerifier, SCENARIO_STATUS } = require('../core/RunVerifier')
const { SCENARIOS } = require('../core/scenarios')
const { describeBot, describeWorkers, ConsoleBuffer } = require('../lib/dashboard-snapshot')
const { startViewer, startInventory } = require('../lib/web-views')

const logPath = path.resolve('.data/test-dashboard-events.jsonl')

function freshLog() {
  try { fs.unlinkSync(logPath) } catch {}
  return new EventLog(logPath)
}

function request(port, { method = 'GET', path: urlPath = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(data) } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: data, json })
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function listening(server) {
  return new Promise((resolve) => {
    if (server._server.listening) return resolve(server._server.address().port)
    server._server.once('listening', () => resolve(server._server.address().port))
  })
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function scenario(overrides = {}) {
  return {
    id: 'fake',
    title: 'Fake',
    action: 'faz nada',
    timeoutMs: 1000,
    preconditions: () => [{ name: 'ok', ok: true }],
    required: ['value'],
    run: async () => ({ value: 1 }),
    validate: (evidence) => (evidence.value === 1 ? [] : ['valor errado']),
    ...overrides
  }
}

async function finished(verifier) {
  for (let i = 0; i < 100 && verifier.currentRun; i++) await sleep(10)
  return verifier.scenarioState().history[0]
}

function makeServer({ scenarios = [scenario()], snapshot = () => ({ main: describeBot({ username: 'eduardo_bot' }) }), views = () => null } = {}) {
  const eventLog = freshLog()
  const runVerifier = new RunVerifier({ eventLog, scenarios })
  runVerifier.setScenarioContext({ bot: { username: 'eduardo_bot' } })
  const server = new StatusServer({
    botManager: { list: () => [], get: () => null },
    storage: { cachedSummary: () => ({ oak_log: 3 }) },
    projectManager: { status: () => null },
    eventLog,
    port: 0,
    dashboard: { runVerifier, snapshot, views }
  })
  server.start()
  return { server, runVerifier, eventLog }
}

// ---------- StatusServer ----------

test('painel desligado por padrão: sem rotas /dashboard e /api', async () => {
  const server = new StatusServer({ botManager: { list: () => [] }, storage: null, projectManager: null, eventLog: freshLog(), port: 0 })
  server.start()
  const port = await listening(server)
  assert.equal((await request(port, { path: '/dashboard' })).status, 404)
  assert.equal((await request(port, { path: '/api/snapshot' })).status, 404)
  assert.equal((await request(port, { path: '/health' })).status, 200)
  server.stop()
})

test('painel escuta só em 127.0.0.1 e serve a página com CSP', async () => {
  const { server } = makeServer()
  const port = await listening(server)
  assert.equal(server._server.address().address, '127.0.0.1')
  const page = await request(port, { path: '/dashboard' })
  assert.equal(page.status, 200)
  assert.match(page.headers['content-type'], /text\/html/)
  assert.match(page.headers['content-security-policy'], /default-src 'none'/)
  assert.match(page.headers['content-security-policy'], /frame-src 'none'/)
  assert.equal(page.headers['access-control-allow-origin'], undefined)
  assert.match(page.body, /Painel do mbot/)
  assert.equal((await request(port, { path: '/dashboard/app.js' })).status, 200)
  assert.equal((await request(port, { path: '/dashboard/../package.json' })).status, 404)
  assert.equal((await request(port, { path: '/dashboard/%2e%2e/package.json' })).status, 404)
  server.stop()
})

test('CSP libera iframe só das visualizações ativas em loopback', async () => {
  const { server } = makeServer({ views: () => ({ viewer: { status: 'ativo', port: 3007 }, inventory: { status: 'desligado', port: 0 } }) })
  const port = await listening(server)
  const csp = (await request(port, { path: '/dashboard' })).headers['content-security-policy']
  assert.match(csp, /frame-src http:\/\/127\.0\.0\.1:3007 http:\/\/localhost:3007;/)
  server.stop()
})

test('painel recusa Host que não seja loopback (DNS rebinding)', async () => {
  const { server } = makeServer()
  const port = await listening(server)
  const res = await request(port, { path: '/api/snapshot', headers: { host: 'evil.example:80' } })
  assert.equal(res.status, 403)
  assert.equal((await request(port, { path: '/api/snapshot', headers: { host: `localhost:${port}` } })).status, 200)
  server.stop()
})

test('snapshot traz bot desconectado, estoque, eventos limitados e rotas antigas seguem', async () => {
  const { server, eventLog } = makeServer()
  for (let i = 0; i < 150; i++) eventLog.log('tick', { i })
  const port = await listening(server)
  const snap = (await request(port, { path: '/api/snapshot' })).json
  assert.equal(snap.main.name, 'eduardo_bot')
  assert.equal(snap.main.connected, false)
  assert.equal(snap.main.position, null)
  assert.deepEqual(snap.storage, { oak_log: 3 })
  assert.equal(snap.events.total, 150)
  assert.equal(snap.events.recent.length, 100)
  assert.ok(snap.timestamp)
  const legacy = await request(port, { path: '/status' })
  assert.equal(legacy.status, 200)
  assert.equal(legacy.headers['access-control-allow-origin'], '*')
  server.stop()
})

test('snapshot com erro no provedor não derruba a rota', async () => {
  const { server } = makeServer({ snapshot: () => { throw new Error('bot ainda não existe') } })
  const port = await listening(server)
  const res = await request(port, { path: '/api/snapshot' })
  assert.equal(res.status, 200)
  assert.equal(res.json.error, 'bot ainda não existe')
  server.stop()
})

test('POST de cenário exige cabeçalho do painel e origem local', async () => {
  const { server, runVerifier } = makeServer()
  const port = await listening(server)
  const run = (headers) => request(port, { method: 'POST', path: '/api/scenarios/fake/run', headers, body: '{}' })

  assert.equal((await run({})).status, 403)
  assert.equal((await run({ 'x-mbot-dashboard': '1', origin: 'http://evil.example' })).status, 403)
  assert.equal(runVerifier.scenarioRuns.length, 0)

  const ok = await run({ 'x-mbot-dashboard': '1', origin: `http://127.0.0.1:${port}` })
  assert.equal(ok.status, 202)
  assert.equal(ok.json.scenarioId, 'fake')
  await finished(runVerifier)
  server.stop()
})

test('POST só aceita ids do catálogo; um cenário por vez', async () => {
  let release
  const slow = scenario({ id: 'lento', run: () => new Promise((resolve) => { release = () => resolve({ value: 1 }) }) })
  const { server, runVerifier } = makeServer({ scenarios: [slow] })
  const port = await listening(server)
  const post = (id) => request(port, { method: 'POST', path: `/api/scenarios/${id}/run`, headers: { 'x-mbot-dashboard': '1' }, body: '{}' })

  assert.equal((await post('nao_existe')).status, 404)
  assert.equal((await post('constructor')).status, 404)
  assert.equal((await post('..%2f..')).status, 404)
  assert.equal((await request(port, { path: '/api/scenarios/lento/run' })).status, 404) // GET não executa
  assert.equal((await post('lento')).status, 202)
  assert.equal((await post('lento')).status, 409)
  release()
  const run = await finished(runVerifier)
  assert.equal(run.status, 'PASS')
  const state = (await request(port, { path: '/api/scenarios' })).json
  assert.equal(state.catalog[0].status, 'PASS')
  assert.equal(state.current, null)
  server.stop()
})

test('stop fecha o painel', async () => {
  const { server } = makeServer()
  const port = await listening(server)
  server.stop()
  await sleep(50)
  await assert.rejects(request(port, { path: '/api/snapshot' }))
})

// ---------- Ciclo de cenários ----------

function verifierWith(scenarios, context = { bot: { username: 'b' } }) {
  const eventLog = freshLog()
  const verifier = new RunVerifier({ eventLog, scenarios })
  verifier.setScenarioContext(context)
  return { verifier, eventLog }
}

test('cenário válido: PENDING → RUNNING → PASS, com eventos e duração', async () => {
  const { verifier, eventLog } = verifierWith([scenario()])
  assert.equal(verifier.listScenarios()[0].status, SCENARIO_STATUS.PENDING)
  const started = verifier.startScenario('fake')
  assert.equal(started.status, 'RUNNING')
  assert.ok(started.startedAt)
  const run = await finished(verifier)
  assert.equal(run.status, 'PASS')
  assert.deepEqual(run.evidence, { value: 1 })
  assert.ok(run.finishedAt && run.durationMs >= 0)
  const statuses = eventLog.getEvents({ type: 'scenario_status' }).map((e) => e.status)
  assert.deepEqual(statuses, ['PENDING', 'RUNNING', 'PASS'])
})

test('evidência que não passa na validação: FAIL com motivo', async () => {
  const { verifier } = verifierWith([scenario({ run: async () => ({ value: 2 }) })])
  verifier.startScenario('fake')
  const run = await finished(verifier)
  assert.equal(run.status, 'FAIL')
  assert.deepEqual(run.reasons, ['valor errado'])
})

test('evidência ausente nunca vira PASS', async () => {
  const { verifier } = verifierWith([scenario({ run: async () => ({}), validate: () => [] })])
  verifier.startScenario('fake')
  const run = await finished(verifier)
  assert.equal(run.status, 'FAIL')
  assert.deepEqual(run.reasons, ['evidência ausente: value'])

  const { verifier: v2 } = verifierWith([scenario({ run: async () => undefined, validate: () => [] })])
  v2.startScenario('fake')
  assert.equal((await finished(v2)).status, 'FAIL')
})

test('pré-condição falsa: BLOCKED sem executar a ação', async () => {
  let ran = false
  const { verifier } = verifierWith([scenario({ preconditions: () => [{ name: 'bot conectado', ok: false, detail: 'sem entidade' }], run: async () => { ran = true; return { value: 1 } } })])
  const run = verifier.startScenario('fake')
  assert.equal(run.status, 'BLOCKED')
  assert.deepEqual(run.reasons, ['bot conectado: sem entidade'])
  assert.equal(ran, false)
  assert.equal(verifier.currentRun, null)
})

test('pré-condição marcada skip: SKIPPED', () => {
  const { verifier } = verifierWith([scenario({ preconditions: () => [{ name: 'viewer ligado', ok: false, skip: true, detail: 'desligado' }] })])
  assert.equal(verifier.startScenario('fake').status, 'SKIPPED')
})

test('ação que lança erro ou estoura o tempo: FAIL e libera o próximo', async () => {
  const { verifier } = verifierWith([
    scenario({ id: 'erro', run: async () => { throw new Error('pathfinder travou') } }),
    scenario({ id: 'lento', timeoutMs: 30, run: (_ctx, isCancelled) => new Promise((resolve) => setTimeout(() => resolve({ value: 1, cancelled: isCancelled() }), 200)) })
  ])
  verifier.startScenario('erro')
  assert.deepEqual((await finished(verifier)).reasons, ['pathfinder travou'])
  verifier.startScenario('lento')
  const run = await finished(verifier)
  assert.equal(run.status, 'FAIL')
  assert.match(run.reasons[0], /tempo esgotado/)
})

test('evidência é redigida e limitada', async () => {
  const { verifier } = verifierWith([
    scenario({ id: 'secreto', run: async () => ({ value: 1, password: 'hunter2', nested: { apiKey: 'x' } }) }),
    scenario({ id: 'grande', run: async () => ({ value: 1, blob: 'x'.repeat(20000) }), validate: () => [] })
  ])
  verifier.startScenario('secreto')
  const run = await finished(verifier)
  assert.equal(run.evidence.password, '[redacted]')
  assert.equal(run.evidence.nested.apiKey, '[redacted]')
  assert.equal(run.status, 'PASS')
  verifier.startScenario('grande')
  const big = await finished(verifier)
  assert.equal(big.status, 'FAIL')
  assert.equal(big.evidence.truncated, true)
})

test('histórico da sessão é limitado e serializável; id desconhecido é recusado', async () => {
  const { verifier } = verifierWith([scenario({ preconditions: () => [{ name: 'x', ok: false }] })])
  for (let i = 0; i < 60; i++) verifier.startScenario('fake')
  const state = verifier.scenarioState()
  assert.equal(state.history.length, 50)
  assert.doesNotThrow(() => JSON.stringify(state))
  assert.equal(state.history[0].promise, undefined)
  assert.throws(() => verifier.startScenario('__proto__'), { code: 'unknown' })
  assert.throws(() => verifier.startScenario({ id: 'fake' }), { code: 'unknown' })
})

test('sem contexto de teste o cenário não inicia', () => {
  const verifier = new RunVerifier({ eventLog: freshLog(), scenarios: [scenario()] })
  assert.throws(() => verifier.startScenario('fake'), { code: 'unavailable' })
})

// ---------- Catálogo real ----------

function fakeBot(overrides = {}) {
  const items = [{ slot: 36, name: 'oak_log', count: 2 }, { slot: 37, name: 'bread', count: 5 }]
  return {
    username: 'eduardo_bot',
    version: '1.20.1',
    entity: { position: { x: 1.234, y: 64, z: -3.5 } },
    health: 20,
    food: 18,
    game: { gameMode: 'survival', dimension: 'overworld' },
    inventory: { items: () => items, slots: Array.from({ length: 46 }, (_, i) => items.find((it) => it.slot === i) || null) },
    ...overrides
  }
}

async function runReal(id, context) {
  const { verifier } = verifierWith(SCENARIOS, context)
  verifier.startScenario(id)
  return finished(verifier)
}

test('catálogo: conexão passa com bot real e bloqueia sem entidade', async () => {
  const bot = fakeBot()
  const run = await runReal('conexao', { bot, dimension: () => 'overworld' })
  assert.equal(run.status, 'PASS')
  assert.deepEqual(run.evidence.position, { x: 1.23, y: 64, z: -3.5 })
  const blocked = await runReal('conexao', { bot: fakeBot({ entity: null }) })
  assert.equal(blocked.status, 'BLOCKED')
})

test('catálogo: conexão reprova vida inválida', async () => {
  const run = await runReal('conexao', { bot: fakeBot({ health: 0 }), dimension: () => 'overworld' })
  assert.equal(run.status, 'FAIL')
  assert.match(run.reasons.join(), /vida/)
})

test('catálogo: inventário confere slots e soma', async () => {
  assert.equal((await runReal('inventario', { bot: fakeBot() })).status, 'PASS')
  const bot = fakeBot()
  bot.inventory.slots = bot.inventory.slots.slice(0, 45)
  const run = await runReal('inventario', { bot })
  assert.equal(run.status, 'FAIL')
  assert.match(run.reasons[0], /46 slots/)
})

test('catálogo: coletar madeira só passa se o inventário ganhar tronco', async () => {
  const items = [{ slot: 36, name: 'oak_log', count: 2 }]
  const bot = fakeBot({ inventory: { items: () => items, slots: [] } })
  const base = { bot, countLogsNearby: () => 5 }

  const mineLog = (gain, mined) => async (_isCancelled, measure) => {
    items[0].count += gain
    return { mined, inventoryAfter: await measure() }
  }
  const fail = await runReal('coletar_madeira', { ...base, mineLog: mineLog(0, 0) })
  assert.equal(fail.status, 'FAIL')
  assert.match(fail.reasons[0], /não aumentaram/)

  const pass = await runReal('coletar_madeira', { ...base, mineLog: mineLog(1, 1) })
  assert.equal(pass.status, 'PASS')
  assert.equal(pass.evidence.inventoryBefore, 2)
  assert.equal(pass.evidence.inventoryAfter, 3)

  const interrupted = await runReal('coletar_madeira', { ...base, mineLog: async (_c, measure) => ({ mined: 0, inventoryAfter: await measure(), interrupted: true }) })
  assert.equal(interrupted.status, 'FAIL')
  assert.match(interrupted.reasons[0], /interrompida/)

  const none = await runReal('coletar_madeira', { ...base, countLogsNearby: () => 0, mineLog: mineLog(1, 1) })
  assert.equal(none.status, 'BLOCKED')
})

test('catálogo: smoke reprova checagem falha e bloqueia sem estoque', async () => {
  const bot = fakeBot()
  const storage = { configured: () => true }
  const failing = await runReal('smoke', { bot, storage, runSmoke: async () => ({ ok: false, passed: 1, failed: 1, checks: [{ name: 'base', ok: false, detail: 'não definida' }] }) })
  assert.equal(failing.status, 'FAIL')
  assert.deepEqual(failing.reasons, ['base: não definida'])
  const passing = await runReal('smoke', { bot, storage, runSmoke: async () => ({ ok: true, passed: 1, failed: 0, checks: [{ name: 'spawn', ok: true }] }) })
  assert.equal(passing.status, 'PASS')
  const blocked = await runReal('smoke', { bot, storage: { configured: () => false } })
  assert.equal(blocked.status, 'BLOCKED')
})

test('catálogo: visualizador é SKIPPED quando desligado', async () => {
  const run = await runReal('visualizador', { bot: fakeBot(), views: () => ({ viewer: { port: 0, status: 'desligado' } }) })
  assert.equal(run.status, 'SKIPPED')
})

// ---------- Retrato e console ----------

test('describeBot e describeWorkers usam os bots reais', () => {
  const main = describeBot(fakeBot(), { role: 'orquestrador' })
  assert.equal(main.connected, true)
  assert.equal(main.dimension, 'overworld')
  assert.equal(main.inventory.length, 2)
  assert.equal(main.role, 'orquestrador')
  const off = describeBot({ username: 'x', health: 20 })
  assert.equal(off.connected, false)
  assert.equal(off.health, null)

  const workerBot = fakeBot({ username: 'minerador_01', colonyController: { state: 'trabalhando', currentTask: { type: 'coletar', resource: 'stone', count: 8 } } })
  const [worker] = describeWorkers({ workers: new Map([['minerador_01', { name: 'minerador_01', role: 'minerador', status: 'ativo', bot: workerBot }]]) })
  assert.equal(worker.status, 'trabalhando')
  assert.deepEqual(worker.task, { type: 'coletar', resource: 'stone', count: 8 })
  assert.deepEqual(describeWorkers(null), [])
})

test('ConsoleBuffer limita, redige e restaura o console', () => {
  const target = { lines: [], log(...a) { this.lines.push(a.join(' ')) }, warn() {}, error() {} }
  const buffer = new ConsoleBuffer(3).capture(target)
  target.log('conectando', { x: 1 })
  target.log('password=segredo123 ok')
  target.error(new Error('falhou'))
  target.log('quarta')
  assert.equal(buffer.recent().length, 3)
  assert.equal(target.lines.length, 3) // os 3 console.log continuam saindo no terminal
  assert.match(buffer.recent()[0].text, /password=\[redacted\] ok/)
  assert.equal(buffer.recent()[1].level, 'error')
  buffer.restore()
  target.log('depois')
  assert.equal(buffer.recent().at(-1).text, 'quarta')
  buffer.push('info', ['x'.repeat(600)])
  assert.equal(buffer.recent(1)[0].text.length, 500)
})

// ---------- Viewer e inventário ----------

test('viewer e inventário ficam desligados sem porta', () => {
  const bot = { version: '1.20.1', on() {}, removeListener() {} }
  assert.equal(startViewer(bot, { port: 0, log: () => {} }).status, 'desligado')
  assert.equal(startInventory(bot, { port: 0, log: () => {} }).status, 'desligado')
})

test('viewer e inventário escutam só em 127.0.0.1', async () => {
  const { EventEmitter } = require('node:events')
  const bot = Object.assign(new EventEmitter(), { version: '1.20.1', inventory: { slots: [] }, entity: null })
  const [vp, ip] = [await freePort(), await freePort()]
  const viewer = startViewer(bot, { port: vp, log: () => {} })
  const inventory = startInventory(bot, { port: ip, log: () => {} })
  for (let i = 0; i < 100 && (viewer.status !== 'ativo' || inventory.status !== 'ativo'); i++) await sleep(20)
  assert.equal(viewer.status, 'ativo')
  assert.equal(viewer.address, '127.0.0.1')
  assert.equal(inventory.address, '127.0.0.1')
  assert.equal((await request(vp, { path: '/' })).status, 200)
  assert.equal((await request(ip, { path: '/' })).status, 200)
  viewer.close()
  inventory.close()
})

test('fim da conexão não gera rejeição sem tratamento no inventário web', async () => {
  const { EventEmitter } = require('node:events')
  const bot = Object.assign(new EventEmitter(), { version: '1.20.1', inventory: { slots: [] }, entity: null })
  const rejections = []
  const onRejection = (err) => rejections.push(err)
  process.on('unhandledRejection', onRejection)
  const inventory = startInventory(bot, { port: await freePort(), log: () => {} })
  for (let i = 0; i < 100 && inventory.status !== 'ativo'; i++) await sleep(20)
  inventory.close() // o index.js fecha primeiro...
  bot.emit('end') // ...e depois o plugin chama o próprio stop()
  await sleep(100)
  process.off('unhandledRejection', onRejection)
  assert.deepEqual(rejections.map((err) => err.message), [])
})

test('viewer recusa versão sem suporte', () => {
  const state = startViewer({ version: '1.99.9' }, { port: 1, log: () => {} })
  assert.equal(state.status, 'sem suporte')
})
