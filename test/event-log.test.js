// test/event-log.test.js
// Tests for the structured event log system.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Mock the module path to avoid needing node_modules for EventLog
// We'll test by directly requiring the module
const { EventLog, LOG_FILE } = require('../lib/event-log')

const testLogPath = path.resolve('.data/test-events.jsonl')

test('logs events with timestamp and type', () => {
  // Clean up
  try { fs.unlinkSync(testLogPath) } catch {}
  const log = new EventLog(testLogPath)

  const event = log.log('test_event', { foo: 'bar' }, 'worker_01')
  assert.equal(event.type, 'test_event')
  assert.equal(event.foo, 'bar')
  assert.equal(event.worker, 'worker_01')
  assert.ok(event.time)
  assert.match(event.time, /\d{4}-\d{2}-\d{2}T/)
})

test('persists events to file', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const log = new EventLog(testLogPath)
  log.log('persist_test', { value: 42 })

  const content = fs.readFileSync(testLogPath, 'utf8').trim()
  assert.ok(content.length > 0)
  const parsed = JSON.parse(content.split('\n')[0])
  assert.equal(parsed.type, 'persist_test')
  assert.equal(parsed.value, 42)
})

test('getEvents returns all events', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const log = new EventLog(testLogPath)
  log.log('alpha')
  log.log('beta')

  const events = log.getEvents()
  assert.equal(events.length, 2)
  assert.ok(events.map(e => e.type).includes('alpha'))
  assert.ok(events.map(e => e.type).includes('beta'))
})

test('getEvents filters by type', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const log = new EventLog(testLogPath)
  log.log('filter_a')
  log.log('filter_b')
  log.log('filter_a')

  const events = log.getEvents({ type: 'filter_a' })
  assert.equal(events.length, 2)
  assert.ok(events.every(e => e.type === 'filter_a'))
})

test('getEvents filters by worker', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const log = new EventLog(testLogPath)
  log.log('w', {}, 'alice')
  log.log('w', {}, 'bob')

  const events = log.getEvents({ worker: 'alice' })
  assert.equal(events.length, 1)
  assert.equal(events[0].worker, 'alice')
})

test('getEvents filters by limit', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const log = new EventLog(testLogPath)
  log.log('e1')
  log.log('e2')
  log.log('e3')

  const recent = log.getEvents({ limit: 2 })
  assert.equal(recent.length, 2)
})

test('getRecent returns most recent events', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const log = new EventLog(testLogPath)
  log.log('first')
  log.log('second')

  const recent = log.getRecent(1)
  assert.equal(recent.length, 1)
  assert.equal(recent[0].type, 'second')
})

test('checkTaskConsistency detects missing tasks', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const log = new EventLog(testLogPath)
  log.log('task_started', { taskId: 'task_1' })
  log.log('task_completed', { taskId: 'task_1' })
  log.log('task_started', { taskId: 'task_2' })

  const consistency = log.checkTaskConsistency()
  assert.equal(consistency.complete, 1)
  assert.equal(consistency.missing.length, 1)
  assert.ok(consistency.missing.includes('task_2'))
})

test('size reflects event count', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const log = new EventLog(testLogPath)
  assert.equal(log.size, 0)
  log.log('e')
  assert.equal(log.size, 1)
})

test('clear removes all events', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const log = new EventLog(testLogPath)
  log.log('e1')
  log.log('e2')
  log.clear()
  assert.equal(log.size, 0)
  assert.equal(log.getEvents().length, 0)
})

test('falha ao gravar no disco não interrompe o chamador', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'event-log-failure-'))
  const blocker = path.join(dir, 'not-a-directory')
  fs.writeFileSync(blocker, 'x')
  const log = new EventLog(path.join(blocker, 'events.jsonl'))
  const event = log.log('runtime_event', { worker: 'from-data' }, 'worker_02')
  assert.equal(event.type, 'runtime_event')
  assert.equal(event.worker, 'worker_02')
  assert.equal(log.getRecent(1)[0].type, 'runtime_event')
  assert.ok(log.lastError)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('limita payload e remove campos sensíveis', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const log = new EventLog(testLogPath)
  const redacted = log.log('safe_event', {
    password: 'do-not-store',
    nested: { api_key: 'also-secret' }
  })
  assert.equal(redacted.password, '[redacted]')
  assert.equal(redacted.nested.api_key, '[redacted]')
  assert.equal(JSON.stringify(redacted).includes('do-not-store'), false)
  assert.equal(JSON.stringify(redacted).includes('also-secret'), false)

  const oversized = log.log('large_event', { payload: 'x'.repeat(20 * 1024) })
  assert.equal(oversized.truncated, true)
})
