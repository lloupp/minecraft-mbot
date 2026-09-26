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
const MAX_EVENTS = Number(process.env.COLONY_EVENT_LOG_MAX || '50000')

class EventLog {
  constructor(filePath = LOG_FILE) {
    this._filePath = path.resolve(filePath)
    this._dir = path.dirname(this._filePath)
    this._buffer = []
    this._size = 0
    this._ensureDir()
    this._size = this._countLines()
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
    const event = {
      time: new Date().toISOString(),
      type,
      worker: workerName || null,
      ...data
    }
    const line = JSON.stringify(event) + '\n'

    // Append to file
    fs.appendFileSync(this.filePath, line, 'utf8')

    // Keep in-memory buffer for quick reads
    this._buffer.push(event)
    this._size++

    // Trim if exceeding max
    if (this._size > MAX_EVENTS) {
      this._trim()
    }

    return event
  }

  _trim() {
    const target = Math.floor(MAX_EVENTS * 0.5)
    const content = fs.readFileSync(this.filePath, 'utf8').trim().split('\n')
    const kept = content.slice(-target)
    fs.writeFileSync(this.filePath, kept.join('\n') + '\n', 'utf8')
    this._size = kept.length
    this._buffer = this._buffer.slice(-target)
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
      return []
    }
    if (!content) return []
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
    fs.writeFileSync(this.filePath, '', 'utf8')
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

module.exports = { EventLog, getEventLog, LOG_FILE }
