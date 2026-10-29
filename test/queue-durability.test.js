const test = require('node:test')
const assert = require('node:assert/strict')
const { RequestQueue } = require('../core/RequestQueue')
const flush = () => new Promise(resolve => setImmediate(resolve))

test('failed cancellation save restores pending request', async () => {
  let fail = false
  const q = new RequestQueue({ candidates: () => [], persist: async () => { if (fail) throw new Error('disk failed') } })
  const item = await q.enqueue('minerador', { type: 'coletar_blocos', count: 1 })
  fail = true
  await assert.rejects(q.cancel(item.id), /disk failed/)
  assert.equal(q.list()[0].status, 'pendente')
})

test('concurrent enqueue failure cannot remove a different request', async () => {
  let rejectFirst
  let calls = 0
  const q = new RequestQueue({ candidates: () => [], persist: async () => {
    if (++calls === 1) await new Promise((resolve, reject) => { rejectFirst = reject })
  } })
  const a = q.enqueue('minerador', { type: 'coletar_blocos', count: 1 })
  const b = q.enqueue('lenhador', { type: 'coletar_blocos', count: 2 })
  const failure = assert.rejects(a, /disk failed/)
  await flush()
  rejectFirst(new Error('disk failed'))
  await failure
  await b
  assert.deepEqual(q.list().map(r => r.role), ['lenhador'])
})

test('save failure before dispatch never starts physical work', async () => {
  let fail = false
  let runs = 0
  const q = new RequestQueue({ candidates: () => [{ name: 'a', role: 'minerador', idle: true, run: () => { runs++; return { ok: true } } }], persist: async () => { if (fail) throw new Error('disk failed') } })
  await q.enqueue('minerador', { type: 'coletar_blocos', count: 1 })
  fail = true
  await assert.rejects(q.dispatch(), /disk failed/)
  await flush()
  assert.equal(runs, 0)
  assert.equal(q.list()[0].status, 'pendente')
})

test('FIFO per eligible worker permits parallel work with other roles', async () => {
  const runs = []
  const waiting = []
  const q = new RequestQueue({ persist: async () => {}, candidates: () => ['minerador', 'lenhador'].map(role => ({ name: role, role, idle: true, run: task => {
    runs.push(task.count)
    return new Promise(resolve => waiting.push(resolve))
  } })) })
  await q.enqueue('minerador', { type: 'coletar_blocos', count: 1 })
  await q.enqueue('minerador', { type: 'coletar_blocos', count: 2 })
  await q.enqueue('lenhador', { type: 'coletar_blocos', count: 3 })
  await q.dispatch()
  await flush()
  assert.deepEqual(runs, [1, 3])
  waiting.forEach(resolve => resolve({ ok: true }))
  await flush()
})
