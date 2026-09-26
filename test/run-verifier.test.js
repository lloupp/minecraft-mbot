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

test('verify reports missing evidence instead of claiming complete success', () => {
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
  verifier._findSourceManifest = () => null
  const proof = verifier.verify()

  assert.ok(proof.checks)
  assert.ok(proof.passed >= 0)
  assert.equal(proof.failed, 0)
  assert.ok(proof.skipped >= 1)
  assert.equal(proof.allPassed, false)
  assert.equal(proof.checks.find((check) => check.name === 'source_provenance').ok, null)
})

test('storage without verify contract is skipped, not marked consistent', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const eventLog = new EventLog(testLogPath)
  eventLog.log('colony_start')
  const verifier = new RunVerifier({ eventLog, storage: { cachedSummary: () => ({}) } })
  verifier._findSourceManifest = () => null
  const proof = verifier.verify()
  const storageCheck = proof.checks.find((check) => check.name === 'storage_consistent')
  assert.equal(storageCheck.ok, null)
  assert.equal(proof.allPassed, false)
})

test('finds freeze manifests under .data/sessions and checks source hashes', () => {
  const sessionsDir = path.resolve('.data/sessions')
  fs.mkdirSync(sessionsDir, { recursive: true })
  const sessionDir = fs.mkdtempSync(path.join(sessionsDir, 'verifier-test-'))
  const sourcePath = path.join(sessionDir, 'source.txt')
  const manifestPath = path.join(sessionDir, 'source-manifest.json')
  fs.writeFileSync(sourcePath, 'verified source')
  const relativeSource = path.relative(process.cwd(), sourcePath)
  const hash = require('node:crypto').createHash('sha256').update('verified source').digest('hex')
  fs.writeFileSync(manifestPath, JSON.stringify({ sessionId: path.basename(sessionDir), files: { [relativeSource]: hash } }))
  try {
    const verifier = new RunVerifier()
    const manifest = verifier._findSourceManifest()
    assert.equal(manifest.sessionId, path.basename(sessionDir))
    assert.equal(verifier._checkSourceHashes(manifest), true)
    fs.writeFileSync(sourcePath, 'changed source')
    assert.equal(verifier._checkSourceHashes(manifest), false)
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true })
  }
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
