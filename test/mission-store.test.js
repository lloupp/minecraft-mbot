const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { MissionStore } = require('../core/MissionStore')

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbot-missions-'))
  return { dir, file: path.join(dir, 'missions.json') }
}

const graph = [{ id: 'n1', action: 'gather', args: { item: 'coal', quantity: 4 } }]

test('cria, salva e recarrega missão', async () => {
  const { dir, file } = tmpFile()
  const store = new MissionStore(file)
  store.create({ id: 'm1', spec: { verb: 'pegar' }, graph })
  store.update('m1', { status: 'completed', evidence: [{ nodeId: 'n1', ok: true }] })
  await store.save()

  const loaded = await new MissionStore(file).load()
  assert.equal(loaded.missions.m1.status, 'completed')
  assert.equal(loaded.missions.m1.graph[0].action, 'gather')
  assert.equal(loaded.missions.m1.evidence.length, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('running vira interrupted no load', async () => {
  const { dir, file } = tmpFile()
  const store = new MissionStore(file)
  store.create({ id: 'm2', graph })
  store.update('m2', { status: 'running' })
  await store.save()

  const loaded = await new MissionStore(file).load()
  assert.equal(loaded.missions.m2.status, 'interrupted')
  assert.equal(loaded.missions.m2.recoveryRequired, true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('arquivo corrompido é preservado e bloqueia autosave', async () => {
  const { dir, file } = tmpFile()
  fs.writeFileSync(file, '{quebrado', 'utf8')
  const store = new MissionStore(file)
  await store.load()
  assert.ok(store.lastLoadError)
  await assert.rejects(() => store.save(), /recupere/)
  assert.equal(fs.readFileSync(file, 'utf8'), '{quebrado')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('escritas concorrentes mantêm JSON válido', async () => {
  const { dir, file } = tmpFile()
  const store = new MissionStore(file)
  store.create({ id: 'a', graph })
  store.create({ id: 'b', graph })
  await Promise.all([store.save(), store.save(), store.save()])
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.deepEqual(Object.keys(parsed.missions).sort(), ['a', 'b'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('id duplicado e grafo inválido são recusados', () => {
  const { dir, file } = tmpFile()
  const store = new MissionStore(file)
  store.create({ id: 'x', graph })
  assert.throws(() => store.create({ id: 'x', graph }), /já existe/)
  assert.throws(() => store.create({ id: 'y', graph: [] }), /grafo/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('prune remove terminais antigos e preserva ativos', () => {
  const { dir, file } = tmpFile()
  const store = new MissionStore(file)
  store.create({ id: 'velha', graph, now: '2020-01-01T00:00:00.000Z' })
  store.update('velha', { status: 'completed' })
  store.create({ id: 'ativa', graph, now: '2020-01-01T00:00:00.000Z' })
  store.update('ativa', { status: 'running' })
  store.prune({ now: Date.parse('2027-01-01T00:00:00.000Z') })
  assert.equal(store.get('velha'), null)
  assert.ok(store.get('ativa'))
  fs.rmSync(dir, { recursive: true, force: true })
})
