// test/status-server.test.js
// Tests for the rich status server.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { EventLog } = require('../lib/event-log')
const { StatusServer } = require('../lib/status-server')

const testLogPath = path.resolve('.data/test-status-events.jsonl')

test('StatusServer constructs with port 0', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const eventLog = new EventLog(testLogPath)
  const server = new StatusServer({
    botManager: { list: () => [], get: () => null },
    storage: { cachedSummary: () => ({}) },
    projectManager: { status: () => [] },
    eventLog,
    port: 0
  })
  assert.equal(server.port, 0)
  server.stop()
})

test('StatusServer starts and stops without error', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const eventLog = new EventLog(testLogPath)
  const server = new StatusServer({
    botManager: { list: () => [], get: () => null },
    storage: { cachedSummary: () => ({}) },
    projectManager: { status: () => [] },
    eventLog,
    port: 0
  })
  server.start()
  assert.equal(server._running, true)
  server.stop()
  assert.equal(server._running, false)
})

test('StatusServer port defaults to 3080', () => {
  try { fs.unlinkSync(testLogPath) } catch {}
  const eventLog = new EventLog(testLogPath)
  const server = new StatusServer({
    botManager: { list: () => [], get: () => null },
    storage: { cachedSummary: () => ({}) },
    projectManager: { status: () => [] },
    eventLog
    // port not specified, defaults to 3080
  })
  assert.equal(server.port, 3080)
  server.stop()
})
