// lib/event-log.js
// Append-only structured event log for the colony.
// Events are persisted to .data/colony-events.jsonl and can be
// replayed for verification, auditing, or replanning decisions.
//
// Inspired by the event-log pattern in minecraft-agent (rmalde),
// where every action, decision, and result is recorded with a
// timestamp, type, and structured data payload.

const fs = require('fs')
const path = require('path')

const LOG_FILE = process.env.COLONY_EVENT_LOG || '.data/colony-events.jsonl'
const configuredMax = Number(process.env.COLONY_EVENT_LOG_MAX || '50000')
const MAX_EVENTS = Number.isSafeInteger(configuredMax) && configuredMax > 0
  ? Math.min(configuredMax, 100000)
  : 50000
const MAX_EVENT_BYTES = 16 * 1024
const MAX_LOG_BYTES = 32 * 1024 * 1024
const SENSITIVE_KEY = /(?:token|password|secret|authorization|cookie|api[_-]?key)/i

function redact(value, depth = 0) {
  if (depth > 6) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redact(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[redacted]' : redact(item, depth + 1)
  ]))
}

class EventLog {
  constructor(filePath = LOG_FILE) {
    this._filePath = path.resolve(filePath)
    this._dir = path.dirname(this._filePath)
    this._buffer = []
    this._size = 0
    this.lastError = null
    try {
      this._ensureDir()
      this._size = this._countLines()
      if (this._size > MAX_EVENTS || (fs.existsSync(this.filePath) && fs.statSync(this.filePath).size > MAX_LOG_BYTES)) this._trim()
    } catch (err) {
      this.lastError = err
    }
  }

  _ensureDir() {
    if (!fs.existsSync(this._dir)) {
      fs.mkdirSync(this._dir, { recursive: true })
    }
  }

  _countLines() {
    try {
      const content = fs.readFileSync(this.filePath, 'utf8').trim()
      if (!content) return 0
      return content.split('\n').length
    } catch {
      return 0
    }
  }

  /**
   * Log a structured event.
   * @param {string} type - Event type (task_started, task_completed, etc.)
   * @param {object} data - Structured data payload
   * @param {string} [workerName] - Optional worker name
   */
  log(type, data = {}, workerName = null) {
    const safeData = redact(data && typeof data === 'object' ? data : {})
    const event = {
      ...safeData,
      time: new Date().toISOString(),
      type: String(type || 'unknown').slice(0, 128),
      worker: workerName == null ? null : String(workerName).slice(0, 128)
    }
    let storedEvent = event
    let line
    try {
      line = JSON.stringify(storedEvent)
    } catch (err) {
      this.lastError = err
      storedEvent = { time: event.time, type: event.type, worker: event.worker, error: 'event serialization failed' }
      line = JSON.stringify(storedEvent)
    }
    if (Buffer.byteLength(line) > MAX_EVENT_BYTES) {
      storedEvent = { time: event.time, type: event.type, worker: event.worker, truncated: true }
      line = JSON.stringify(storedEvent)
    }

    this._buffer.push(storedEvent)
    if (this._buffer.length > MAX_EVENTS) this._buffer.splice(0, this._buffer.length - MAX_EVENTS)
    this._size++

    try {
      fs.appendFileSync(this.filePath, line + '\n', 'utf8')
      if (this._size > MAX_EVENTS || fs.statSync(this.filePath).size > MAX_LOG_BYTES) this._trim()
    } catch (err) {
      // Audit failure must not interrupt bot/worker runtime.
      this.lastError = err
    }
    return storedEvent
  }

  _trim() {
    const targetCount = Math.max(1, Math.floor(MAX_EVENTS * 0.5))
    const content = fs.readFileSync(this.filePath, 'utf8').trim().split('\n')
    const selected = []
    let bytes = 1
    for (let i = content.length - 1; i >= 0 && selected.length < targetCount; i--) {
      const lineBytes = Buffer.byteLength(content[i]) + (selected.length ? 1 : 0)
      if (selected.length && bytes + lineBytes > MAX_LOG_BYTES / 2) break
      selected.unshift(content[i])
      bytes += lineBytes
    }
    const kept = selected
    fs.writeFileSync(this.filePath, kept.join('\n') + '\n', 'utf8')
    this._size = kept.length
    this._buffer = this._buffer.slice(-kept.length)
  }

  /**
   * Get all events, optionally filtered by type or worker.
   * @param {object} [filter] - { type?: string, worker?: string, since?: ISOString }
   * @returns {object[]}
   */
  getEvents(filter = {}) {
    let content
    try {
      content = fs.readFileSync(this.filePath, 'utf8').trim()
    } catch {
      content = ''
    }
    if (!content) {
      let events = [...this._buffer]
      if (filter.type) events = events.filter((event) => event.type === filter.type)
      if (filter.worker) events = events.filter((event) => event.worker === filter.worker)
      if (filter.since) events = events.filter((event) => new Date(event.time) >= new Date(filter.since))
      if (filter.limit) events = events.slice(-filter.limit)
      return events
    }
    const lines = content.split('\n')
    let events = lines.map(line => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)

    if (filter.type) events = events.filter(e => e.type === filter.type)
    if (filter.worker) events = events.filter(e => e.worker === filter.worker)
    if (filter.since) events = events.filter(e => new Date(e.time) >= new Date(filter.since))
    if (filter.limit) events = events.slice(-filter.limit)

    return events
  }

  /**
   * Get the most recent N events.
   * @param {number} n
   * @returns {object[]}
   */
  getRecent(n = 100) {
    return this.getEvents({ limit: n })
  }

  /**
   * Check if every task_started has a corresponding task_completed.
   * @returns {{ complete: number, incomplete: number, missing: string[] }}
   */
  checkTaskConsistency() {
    const events = this.getEvents({ type: 'task_started' })
    const completed = this.getEvents({ type: 'task_completed' })
    const completedIds = new Set(completed.map(e => e.taskId || e.id))
    const missing = events.filter(e => !completedIds.has(e.taskId || e.id))
    return {
      complete: completed.length,
      incomplete: missing.length,
      missing: missing.map(e => e.taskId || e.id)
    }
  }

  /**
   * Clear the log file (use with caution).
   */
  clear() {
    try {
      fs.writeFileSync(this.filePath, '', 'utf8')
    } catch (err) {
      this.lastError = err
    }
    this._buffer = []
    this._size = 0
  }

  /**
   * Get total event count.
   */
  get size() { return this._size }

  /**
   * Get the log file path.
   */
  get filePath() { return this._filePath }
}

// Singleton instance shared across the application
let _instance = null
function getEventLog(filePath) {
  if (!_instance) _instance = new EventLog(filePath)
  return _instance
}

module.exports = { EventLog, getEventLog, LOG_FILE, redact }
