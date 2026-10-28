const test = require('node:test')
const assert = require('node:assert/strict')
const { RequestQueue } = require('../core/RequestQueue')

test('pedidos são persistidos antes de iniciar e não interrompem worker ocupado', async () => {
  const history = []
  let busy = true
  let finish
  const queue = new RequestQueue({ persist: async state => history.push(state), candidates: () => [{ name: 'a', role: 'minerador', idle: !busy, run: () => new Promise(resolve => { finish = resolve }) }] })
  await queue.enqueue('minerador', { type: 'coletar_blocos', resource: 'ferro', count: 4 })
  await queue.dispatch()
  assert.equal(queue.list()[0].status, 'pendente')
  busy = false
  await queue.dispatch()
  assert.equal(queue.list()[0].status, 'em_andamento')
  assert.equal(history.at(-1)[0].status, 'em_andamento')
  finish({ ok: true, gathered: 4, deposited: { raw_iron: 4 } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(queue.list()[0].status, 'revisao')
})

test('reinício bloqueia tarefas em andamento sem repetir trabalho', () => {
  const queue = new RequestQueue({ persist: async () => {}, candidates: () => [] })
  queue.restore([{ id: '1', role: 'minerador', task: { type: 'coletar_blocos', count: 4 }, status: 'em_andamento' }])
  assert.equal(queue.list()[0].status, 'interrompido')
})

test('coleta sem depósito confirmado não é concluída', async () => {
  const queue = new RequestQueue({ persist: async () => {}, candidates: () => [{ name: 'a', role: 'minerador', idle: true, run: async () => ({ ok: true, gathered: 4, deposited: {} }) }] })
  await queue.enqueue('minerador', { type: 'coletar_blocos', resource: 'ferro', count: 4 })
  await queue.dispatch()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(queue.list()[0].status, 'revisao')
})
