const test = require('node:test')
const assert = require('node:assert/strict')

const resume = require('../lib/resume-task')

test('registra apenas tarefas próprias conhecidas', () => {
  assert.equal(resume.record({ kind: 'voar' }), null)
  assert.deepEqual(resume.record({ kind: 'lapis', target: 64 }, 1000), { kind: 'lapis', target: 64, at: 1000 })
  assert.deepEqual(resume.record({ kind: 'dar', name: 'lapis_lazuli', amount: 32 }, 5), { kind: 'dar', name: 'lapis_lazuli', amount: 32, at: 5 })
})

test('não retoma enquanto alguém dorme, mas mantém o registro', () => {
  const task = resume.record({ kind: 'lapis', target: 64 }, 1000)
  const result = resume.canResume(task, { sleeping: [{ name: 'Eduardo' }], at: 2000 })
  assert.equal(result.ok, false)
  assert.equal(result.keep, true)
  assert.equal(resume.pending(task).target, 64)
})

test('retoma quando ninguém está dormindo', () => {
  const task = resume.record({ kind: 'dar', name: 'lapis_lazuli', amount: 64 }, 1000)
  const result = resume.canResume(task, { sleeping: [], at: 2000 })
  assert.equal(result.ok, true)
  assert.equal(result.task.name, 'lapis_lazuli')
})

test('registro antigo não é retomado', () => {
  const task = resume.record({ kind: 'lapis', target: 64 }, 1000)
  const result = resume.canResume(task, { at: 1000 + resume.MAX_AGE_MS + 1 })
  assert.equal(result.ok, false)
  assert.match(result.reason, /antigo/)
})

test('espera crescente e limite de tentativas de retomada', () => {
  assert.equal(resume.retryDelay(1), 30000)
  assert.equal(resume.retryDelay(2), 60000)
  assert.equal(resume.retryDelay(20), 300000)
  assert.equal(resume.retryDelay(0), 30000)
  assert.equal(resume.MAX_ATTEMPTS, 6)
})

test('estado vazio ou inválido não vira tarefa', () => {
  assert.equal(resume.pending(null), null)
  assert.equal(resume.pending({}), null)
  assert.equal(resume.pending({ kind: 'outra' }), null)
  assert.equal(resume.canResume(null).ok, false)
})

test('descreve a tarefa pendente para o log', () => {
  assert.equal(resume.describe(resume.record({ kind: 'lapis', target: 64 })), 'minerar 64 lápis')
  assert.equal(resume.describe(resume.record({ kind: 'dar', name: 'lapis_lazuli', amount: 10 })), 'entregar 10x lapis_lazuli')
  assert.equal(resume.describe(null), 'nada pendente')
})
