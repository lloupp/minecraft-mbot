// test/run-verifier.test.js
// Tests for the run verification framework.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { EventLog } = require('../lib/event-log')
const { RunVerifier } = require('../core/RunVerifier')

const testLogPath = path.resolve('.data/test-verifier-events.jsonl')
const proofPath = path.resolve('.data/colony-proof.json')

test('verify returns proof with all checks passing when tasks complete', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  try { fs.unlinkSync(proofPath) } catch {}

  const eventLog = new EventLog(testLogPath)
  eventLog.log('task_started', { taskId: 't1' })
  eventLog.log('task_completed', { taskId: 't1' })

  const verifier = new RunVerifier({
    eventLog,
    storage: { verify: () => ({ consistent: true }), summary: () => ({}) },
    botManager: null,
    projectManager: null
  })
  const proof = verifier.verify()

  assert.ok(proof.checks)
  assert.ok(proof.passed >= 0)
  assert.equal(proof.failed, 0)
  assert.equal(proof.allPassed, true)
})

test('task_consistency fails when tasks incomplete', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const eventLog = new EventLog(testLogPath)
  eventLog.log('task_started', { taskId: 't1' })
  eventLog.log('task_completed', { taskId: 't1' })
  eventLog.log('task_started', { taskId: 't2' })

  const verifier = new RunVerifier({
    eventLog,
    storage: { verify: () => ({ consistent: true }), summary: () => ({}) },
    botManager: null,
    projectManager: null
  })
  const proof = verifier.verify()
  const consistencyCheck = proof.checks.find(c => c.name === 'task_consistency')
  assert.equal(consistencyCheck.ok, false)
})

test('worker_deaths check passes with no deaths', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const eventLog = new EventLog(testLogPath)
  const verifier = new RunVerifier({
    eventLog,
    storage: { verify: () => ({ consistent: true }), summary: () => ({}) },
    botManager: null,
    projectManager: null
  })
  const proof = verifier.verify()
  const deathsCheck = proof.checks.find(c => c.name === 'worker_deaths')
  assert.equal(deathsCheck.ok, true)
})

test('event_log_exists fails with no events', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const eventLog = new EventLog(testLogPath)
  const verifier = new RunVerifier({
    eventLog,
    storage: null,
    botManager: null,
    projectManager: null
  })
  const proof = verifier.verify()
  const eventCheck = proof.checks.find(c => c.name === 'event_log_exists')
  assert.equal(eventCheck.ok, false)
})

test('checkEventCount works', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const eventLog = new EventLog(testLogPath)
  eventLog.log('task_started', {})
  eventLog.log('task_started', {})

  const verifier = new RunVerifier({
    eventLog,
    storage: null,
    botManager: null,
    projectManager: null
  })
  assert.equal(verifier.checkEventCount('task_started', 2), true)
  assert.equal(verifier.checkEventCount('task_started', 3), false)
})

test('proof is saved to file', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  try { fs.unlinkSync(proofPath) } catch {}
  const eventLog = new EventLog(testLogPath)
  eventLog.log('task_started', { taskId: 't1' })

  const verifier = new RunVerifier({
    eventLog,
    storage: null,
    botManager: null,
    projectManager: null
  })
  verifier.verify()
  assert.ok(fs.existsSync(proofPath))
})
