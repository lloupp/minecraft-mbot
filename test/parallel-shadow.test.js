'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { startParallelShadow } = require('../lib/parallel-shadow')

test('parallel shadow starts without awaiting proposals or granting execution authority', () => {
  const originalFetch = global.fetch
  global.fetch = () => new Promise(() => {})
  try {
    const result = startParallelShadow({ state: {}, candidates: [], layaUrl: 'http://laya', nanoandyUrl: 'http://nano' })
    assert.deepEqual(result, { started: true, executionAuthority: 'existing_system_only' })
  } finally {
    global.fetch = originalFetch
  }
})

test('shadow proposals never return a chosen action to the runtime caller', async () => {
  const originalFetch = global.fetch
  global.fetch = async () => ({ ok: true, json: async () => ({ choice: 'unknown' }) })
  const recorded = []
  try {
    startParallelShadow({ state: {}, candidates: [{ id: 'continue_objective' }],
      layaUrl: 'http://laya', nanoandyUrl: 'http://nano', record: value => recorded.push(value) })
    await new Promise(resolve => setImmediate(resolve))
  } finally {
    global.fetch = originalFetch
  }
  assert.equal(recorded.length, 2)
  assert.ok(recorded.every(proposal => proposal.executionAuthority === 'none'))
  assert.ok(recorded.every(proposal => !Object.hasOwn(proposal, 'action')))
})
