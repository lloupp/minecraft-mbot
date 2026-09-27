const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { StateStore } = require('../core/StateStore')

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mbot-state-safety-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'state.json')
  return { dir, file, store: new StateStore(file) }
}

for (const raw of ['{broken', 'null', '[]', '{"version":0,"auto":true}', '{"version":2,"auto":true}', '{"auto":true}']) {
  test(`invalid state remains intact after autosave: ${raw}`, async (t) => {
    const { file, store } = await fixture(t)
    await fs.writeFile(file, raw)
    const loaded = await store.load()
    assert.equal(loaded.auto, false)
    assert.equal(loaded.companionAuto, false)
    assert.deepEqual(loaded.workers, {})
    assert.equal(loaded.project, null)
    assert.ok(store.lastLoadError)
    await assert.rejects(store.save(loaded), { code: 'STATE_RECOVERY_REQUIRED' })
    assert.equal(await fs.readFile(file, 'utf8'), raw)
  })
}

test('abandoned partial temporary file does not replace last confirmed state', async (t) => {
  const { file, store } = await fixture(t)
  await store.save({ workers: { minerador: 2 }, auto: false })
  await fs.writeFile(`${file}.tmp-999999`, '{"version":')
  const loaded = await new StateStore(file).load()
  assert.deepEqual(loaded.workers, { minerador: 2 })
  assert.equal(loaded.auto, false)
  await store.save({ workers: { minerador: 1 } })
  assert.deepEqual((await store.load()).workers, { minerador: 1 })
})

test('failed serialization preserves prior file and write queue recovers', async (t) => {
  const { file, store } = await fixture(t)
  await store.save({ auto: false })
  const before = await fs.readFile(file, 'utf8')
  const cyclic = {}; cyclic.self = cyclic
  await assert.rejects(store.save({ project: cyclic }), TypeError)
  assert.equal(await fs.readFile(file, 'utf8'), before)
  await store.save({ auto: true, version: 999 })
  assert.equal((await store.load()).version, 1)
  assert.equal((await store.load()).auto, true)
  assert.deepEqual((await fs.readdir(path.dirname(file))).filter(f => f.includes('.tmp-')), [])
})

test('queued writes preserve independent snapshots', async (t) => {
  const { store } = await fixture(t)
  await Promise.all([store.save({ auto: true }), store.save({ auto: false })])
  assert.equal((await store.load()).auto, false)
})
