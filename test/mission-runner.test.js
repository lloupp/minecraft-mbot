const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { MissionStore } = require('../core/MissionStore')
const { MissionRunner } = require('../core/MissionRunner')

function setup(nodes, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbot-runner-'))
  const store = new MissionStore(path.join(dir, 'missions.json'))
  const mission = store.create({ id: 'm1', spec: options.spec || {}, graph: nodes })
  return { dir, store, mission }
}

function runner(store, executors, options = {}) {
  return new MissionRunner({
    store,
    executors,
    verifiers: { ok: async () => ({ ok: true }), never: async () => ({ ok: false, detail: 'não aconteceu' }) },
    eventLog: { log: () => {} },
    sleep: async () => {},
    maxAttempts: options.maxAttempts || 1,
    retryBaseMs: 1,
    retryMaxMs: 1,
    preflight: options.preflight || null
  })
}

const node = (id, action = 'gather', extra = {}) => ({
  id,
  action,
  args: { item: 'coal', quantity: 4 },
  verify: 'ok',
  ...extra
})

test('missão de um nó conclui e persiste evidência', async () => {
  const { dir, store } = setup([node('n1')])
  const run = runner(store, { gather: async () => ({ ok: true, evidence: { before: 0, after: 4 } }) })
  const result = await run.run('m1')
  assert.equal(result.ok, true)
  assert.equal(result.status, 'completed')
  assert.equal(store.get('m1').status, 'completed')
  assert.equal(store.get('m1').evidence.length, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('respeita dependência entre nós', async () => {
  const { dir, store } = setup([node('n1'), node('n2', 'deposit', { dependsOn: ['n1'] })])
  const order = []
  const run = runner(store, {
    gather: async () => { order.push('n1'); return { ok: true, evidence: {} } },
    deposit: async () => { order.push('n2'); return { ok: true, evidence: {} } }
  })
  const result = await run.run('m1')
  assert.equal(result.ok, true)
  assert.deepEqual(order, ['n1', 'n2'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('retry não deixa o nó preso em running', async () => {
  const { dir, store } = setup([node('n1')])
  let calls = 0
  const run = runner(store, {
    gather: async () => {
      calls++
      return calls === 1 ? { ok: false, code: 'PATH_TIMEOUT', error: 'demorou' } : { ok: true, evidence: {} }
    }
  }, { maxAttempts: 2 })
  const result = await run.run('m1')
  assert.equal(result.ok, true)
  assert.equal(calls, 2)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('esgotar tentativas falha com causa classificada', async () => {
  const { dir, store } = setup([node('n1')])
  const run = runner(store, { gather: async () => ({ ok: false, code: 'PATH_TIMEOUT', error: 'demorou' }) }, { maxAttempts: 2 })
  const result = await run.run('m1')
  assert.equal(result.status, 'failed')
  assert.equal(result.failure.code, 'PATH_TIMEOUT')
  assert.equal(store.get('m1').evidence.length, 2)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('verificação negativa impede conclusão', async () => {
  const { dir, store } = setup([node('n1', 'gather', { verify: 'never' })])
  const run = runner(store, { gather: async () => ({ ok: true, evidence: {} }) })
  const result = await run.run('m1')
  assert.equal(result.status, 'failed')
  assert.equal(result.failure.code, 'VERIFICATION_FAILED')
  assert.equal(store.get('m1').status, 'failed')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('preflight bloqueia antes de executar', async () => {
  const { dir, store } = setup([node('n1')])
  let calls = 0
  const run = runner(store, { gather: async () => { calls++; return { ok: true } } }, {
    maxAttempts: 1,
    preflight: () => ({ ok: false, blockers: [{ code: 'INVENTORY_FULL', detail: 'cheio' }] })
  })
  const result = await run.run('m1')
  assert.equal(result.status, 'failed')
  assert.equal(result.failure.code, 'INVENTORY_FULL')
  assert.equal(calls, 0)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('cancelamento externo marca interrupted e não completed', async () => {
  const { dir, store } = setup([node('n1')])
  let cancelled = false
  const run = runner(store, {
    gather: async () => { cancelled = true; return { ok: true, evidence: {} } }
  })
  const result = await run.run('m1', { isCancelled: () => cancelled })
  assert.equal(result.status, 'interrupted')
  assert.equal(store.get('m1').status, 'interrupted')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('cancelamento explícito antes de rodar marca cancelled', async () => {
  const { dir, store } = setup([node('n1')])
  const run = runner(store, { gather: async () => ({ ok: true }) })
  assert.equal(await run.cancel('m1'), true)
  assert.equal(store.get('m1').status, 'cancelled')
  fs.rmSync(dir, { recursive: true, force: true })
})
