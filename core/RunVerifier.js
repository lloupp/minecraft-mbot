// core/RunVerifier.js
// Verification framework for colony runs.
// Checks event log consistency, worker safety, source provenance,
// and generates a proof file (.data/colony-proof.json).
//
// Inspired by minecraft-agent's verify-run.mjs which checks:
//   - fresh start, capture coverage, dragon killed, exit portal,
//     survival mode, difficulty match, commands disabled,
//     source hashes unchanged, no runtime repair, JEV controls,
//     etc.
// Adapted for the colony context.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { getEventLog } = require('../lib/event-log')

const PROOF_FILE = process.env.COLONY_PROOF_FILE || '.data/colony-proof.json'

class RunVerifier {
  constructor({ eventLog = null, storage = null, botManager = null, projectManager = null } = {}) {
    this.eventLog = eventLog || getEventLog()
    this.storage = storage
    this.botManager = botManager
    this.projectManager = projectManager
    this.proof = null
  }

  /**
   * Run all verification checks.
   * @returns {object} proof object with checks and passed/failed status
   */
  verify() {
    const checks = []
    const add = (name, ok, detail = '') => checks.push({ name, ok: ok == null ? null : Boolean(ok), detail })

    // 1. Event log exists and has events
    const eventCount = this.eventLog.size
    add('event_log_exists', eventCount > 0, `${eventCount} events recorded`)

    // 2. Task consistency - every task_started has a task_completed
    const consistency = this.eventLog.checkTaskConsistency()
    add('task_consistency', consistency.missing.length === 0,
      `${consistency.complete} complete, ${consistency.missing.length} missing`)

    // 3. Worker safety - no unexpected deaths
    const deaths = this.eventLog.getEvents({ type: 'worker_death' })
    add('worker_deaths', deaths.length === 0, `${deaths.length} worker deaths recorded`)

    // 4. Storage consistency
    if (typeof this.storage?.verify === 'function') {
      try {
        const invCheck = this.storage.verify()
        add('storage_consistent', invCheck?.consistent, `${invCheck?.mismatches?.length || 0} mismatches`)
      } catch (err) {
        add('storage_consistent', false, `verification failed: ${err.message}`)
      }
    } else {
      add('storage_consistent', null, this.storage ? 'storage has no verification contract' : 'storage unavailable')
    }

    // 5. Source provenance is checked from the session directory written by freeze-colony.
    try {
      const sourceManifest = this._findSourceManifest()
      if (sourceManifest) {
        add('source_provenance', this._checkSourceHashes(sourceManifest), 'source hashes checked')
      } else {
        add('source_provenance', null, 'no freeze manifest found')
      }
    } catch (err) {
      add('source_provenance', false, `manifest verification failed: ${err.message}`)
    }

    // 6. No operator guidance events
    const operatorEvents = this.eventLog.getEvents({ type: 'operator_guidance' })
    add('no_operator_guidance', operatorEvents.length === 0, `${operatorEvents.length} operator events`)

    // 7. All workers active or accounted for
    if (this.botManager) {
      const workers = this.botManager.list?.() || []
      const active = workers.filter(w => w.status !== 'disconnected' && w.status !== 'error')
      add('workers_active', workers.length ? active.length > 0 : null,
        workers.length ? `${active.length}/${workers.length} workers active` : 'no workers to verify')
    }

    // 8. Projects completed or progressing
    if (this.projectManager) {
      const projects = this.projectManager.status?.() || []
      add('projects_exist', projects.length ? true : null,
        projects.length ? `${projects.length} projects` : 'no active projects to verify')
    }

    this.proof = {
      runId: process.env.RUN_ID || 'colony-' + Date.now(),
      verifiedAt: new Date().toISOString(),
      checks,
      passed: checks.filter(c => c.ok === true).length,
      failed: checks.filter(c => c.ok === false).length,
      skipped: checks.filter(c => c.ok === null).length,
      total: checks.length,
      allPassed: checks.every(c => c.ok === true)
    }

    // Save proof
    const proofPath = path.resolve(PROOF_FILE)
    const dir = path.dirname(proofPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(proofPath, JSON.stringify(this.proof, null, 2), 'utf8')

    return this.proof
  }

  /**
   * Find source manifest from freeze.
   * @private
   */
  _findSourceManifest() {
    const sessionsDir = path.resolve('.data/sessions')
    if (!fs.existsSync(sessionsDir)) return null
    const candidates = fs.readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(sessionsDir, entry.name, 'source-manifest.json'))
      .filter((manifestPath) => fs.existsSync(manifestPath))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    if (!candidates.length) return null
    try {
      return JSON.parse(fs.readFileSync(candidates[0], 'utf8'))
    } catch (err) {
      throw new Error(`invalid source manifest: ${err.message}`)
    }
  }

  /**
   * Check if source file hashes match the manifest.
   * @private
   */
  _checkSourceHashes(manifest) {
    if (!manifest || !manifest.files) return false
    for (const [filePath, expectedHash] of Object.entries(manifest.files)) {
      const fullPath = path.resolve(filePath)
      if (!fs.existsSync(fullPath)) return false
      const actualHash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex')
      if (actualHash !== expectedHash) return false
    }
    return true
  }

  /**
   * Get the proof from the last verification.
   */
  getProof() { return this.proof }

  /**
   * Verify a specific event type count matches expected.
   * @param {string} type - Event type
   * @param {number} expected - Expected count (or minimum)
   * @returns {boolean}
   */
  checkEventCount(type, expected) {
    const events = this.eventLog.getEvents({ type })
    return events.length >= expected
  }
}

module.exports = { RunVerifier, PROOF_FILE }
