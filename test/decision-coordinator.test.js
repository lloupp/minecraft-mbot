const test = require('node:test')
const assert = require('node:assert/strict')
const { DecisionCoordinator, normalizeCandidates } = require('../core/DecisionCoordinator')

const candidates = [
  { id: 'gather', tool: 'gather', args: { resource: 'oak_log', quantity: 6 } },
  { id: 'wait', tool: 'get_state', args: {} }
]

test('candidate args are prepared outside the model and preserved', async () => {
  const conversa = {
    async decide(state) {
      assert.deepEqual(state.availableActions, ['gather', 'wait'])
      return { source: 'conversa-llm', action: 'gather', confidence: 0.9, trusted: true }
    }
  }
  const coordinator = new DecisionCoordinator({ mode: 'conversa-llm', conversa, logger: { log() {} } })
  const chosen = await coordinator.choose({ state: { worker: 'w1' }, candidates, fallbackId: 'wait' })
  assert.equal(chosen.selected.tool, 'gather')
  assert.deepEqual(chosen.selected.args, { resource: 'oak_log', quantity: 6 })
})

test('untrusted model choice falls back to deterministic candidate', async () => {
  const conversa = { async decide() { return { source: 'deterministic', action: 'wait', reason: 'low_confidence' } } }
  const coordinator = new DecisionCoordinator({ mode: 'conversa-llm', conversa })
  const chosen = await coordinator.choose({ state: { worker: 'w1' }, candidates, fallbackId: 'wait' })
  assert.equal(chosen.source, 'deterministic')
  assert.equal(chosen.selected.id, 'wait')
  assert.equal(chosen.fallback, true)
})

test('Julia shadow can observe but never selects executed candidate', async () => {
  const shadow = async () => ({ action: 'gather', confidence: 0.99, trusted: false, shadow: true })
  const coordinator = new DecisionCoordinator({ mode: 'julia-shadow', juliaShadow: shadow })
  const chosen = await coordinator.choose({ state: { worker: 'w1' }, candidates, fallbackId: 'wait' })
  assert.equal(chosen.selected.id, 'wait')
  assert.equal(chosen.source, 'deterministic')
  assert.equal(chosen.shadow.action, 'gather')
})

test('execute sends only prevalidated candidate tool and args to Tool Layer', async () => {
  let decision
  const toolLayer = {
    async execute(value) { decision = value; return { success: true } }
  }
  const conversa = { async decide() { return { source: 'conversa-llm', action: 'gather', confidence: 0.9, trusted: true } } }
  const coordinator = new DecisionCoordinator({ mode: 'conversa-llm', conversa, logger: { log() {} } })
  const out = await coordinator.execute({
    toolLayer,
    state: { worker: 'wood-1' },
    candidates,
    fallbackId: 'wait',
    objective: 'collect wood'
  })
  assert.equal(out.engine, 'conversa-llm')
  assert.deepEqual(decision, {
    worker: 'wood-1',
    objective: 'collect wood',
    action: 'gather',
    args: { resource: 'oak_log', quantity: 6 }
  })
})

test('candidate validation rejects unknown and duplicate model actions', () => {
  assert.throws(() => normalizeCandidates([{ id: 'bash', tool: 'gather' }]), /inválido/)
  assert.throws(() => normalizeCandidates([
    { id: 'gather', tool: 'gather' },
    { id: 'gather', tool: 'gather' }
  ]), /duplicado/)
})

test('Laya can select only one of the prepared safe candidates', async () => {
  const laya = {
    async decide(state) {
      assert.deepEqual(state.availableActions, ['gather', 'wait'])
      assert.deepEqual(state.candidateReasons, {
        gather: null,
        wait: null
      })
      return { source: 'laya', action: 'gather', confidence: 0.82, trusted: true }
    }
  }

  const coordinator = new DecisionCoordinator({
    mode: 'laya',
    laya,
    logger: { log() {} }
  })

  const chosen = await coordinator.choose({
    state: { worker: 'wood-1' },
    candidates,
    fallbackId: 'wait'
  })

  assert.equal(chosen.source, 'laya')
  assert.equal(chosen.selected.id, 'gather')
  assert.equal(chosen.confidence, 0.82)
})

test('Laya rejection falls back to prepared deterministic candidate', async () => {
  const laya = {
    async decide() {
      return { source: 'deterministic', action: 'wait', reason: 'timeout' }
    }
  }

  const coordinator = new DecisionCoordinator({ mode: 'laya', laya })
  const chosen = await coordinator.choose({
    state: { worker: 'wood-1' },
    candidates,
    fallbackId: 'wait'
  })

  assert.equal(chosen.source, 'deterministic')
  assert.equal(chosen.selected.id, 'wait')
  assert.equal(chosen.fallback, true)
  assert.equal(chosen.reason, 'timeout')
})
