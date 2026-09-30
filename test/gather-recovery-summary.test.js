'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { summarizeGatherRecovery } = require('../core/WorkerController')

test('resume recuperação quando falha com candidato alternativo e tentativa seguinte confirma item', () => {
  const summary = summarizeGatherRecovery([
    { code: 'PATH_FAILED', alternateTargetCandidateObserved: true, itemConfirmed: false },
    { itemConfirmed: true }
  ])
  assert.deepEqual(summary, {
    alternateTargetObserved: true,
    alternateTargetRecoveryConfirmed: true
  })
})

test('não afirma recuperação quando só observa candidato alternativo sem sucesso posterior', () => {
  const summary = summarizeGatherRecovery([
    { code: 'PATH_FAILED', alternateTargetCandidateObserved: true, itemConfirmed: false },
    { code: 'ITEM_NOT_CONFIRMED', itemConfirmed: false }
  ])
  assert.deepEqual(summary, {
    alternateTargetObserved: true,
    alternateTargetRecoveryConfirmed: false
  })
})

test('cancelamento não cria evidência de recuperação', () => {
  const summary = summarizeGatherRecovery([
    { code: 'CANCELLED', alternateTargetCandidateObserved: true, itemConfirmed: false }
  ])
  assert.deepEqual(summary, {
    alternateTargetObserved: false,
    alternateTargetRecoveryConfirmed: false
  })
})
