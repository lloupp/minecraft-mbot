const test = require('node:test')
const assert = require('node:assert/strict')
const { evaluate, longestStuckSeconds } = require('../scripts/soak-gate')

const limits = { maxDeaths: 1, minAutoResults: 1, maxStuckSeconds: 60, maxStockOpenFailures: 3, stuckRadius: 2 }
const sample = (s, x, task = { type: 'coletar_blocos' }) => ({ elapsedMs: s * 1000, workers: [{ worker: 'w1', position: { x, y: 64, z: 0 }, currentTask: task }] })

function run(overrides = {}) {
  return {
    name: 'control', status: 'COMPLETED', deaths: 0, autoResults: 5, stockOpenFailures: 0, positionTypeErrors: 0,
    minimumHealth: 18, minimumFood: 15, samples: [sample(0, 0), sample(30, 10), sample(60, 20)], ...overrides
  }
}

test('longestStuckSeconds mede só parada com tarefa e reinicia ao se mover', () => {
  const samples = [sample(0, 0), sample(50, 1), sample(100, 1.5), sample(110, 30), sample(400, 30, null), sample(500, 30)]
  assert.equal(longestStuckSeconds(samples, 'w1', 2), 100)
})

test('soak saudável passa', () => {
  const result = evaluate({ status: 'PASS', runs: [run()] }, limits)
  assert.equal(result.ok, true)
  assert.equal(result.metrics[0].longestStuckSeconds, 0)
})

test('reprova mortes, ausência de trabalho, worker parado e erros de posição', () => {
  const result = evaluate({
    status: 'PASS',
    runs: [run({ deaths: 3, autoResults: 0, positionTypeErrors: 2, stockOpenFailures: 9, samples: [sample(0, 0), sample(120, 0)] })]
  }, limits)
  assert.equal(result.ok, false)
  assert.equal(result.failures.length, 5)
  assert.match(result.failures.join('\n'), /3 morte/)
  assert.match(result.failures.join('\n'), /parado com tarefa por 120s/)
})

test('soak que não terminou reprova mesmo sem execuções', () => {
  const result = evaluate({ status: 'FAIL', error: 'server exited\n at x' }, limits)
  assert.equal(result.ok, false)
  assert.deepEqual(result.failures, ['soak não terminou: FAIL server exited', 'nenhuma execução registrada'])
})
