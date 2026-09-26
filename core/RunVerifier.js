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
const { getEventLog, redact } = require('../lib/event-log')
const { SCENARIOS } = require('./scenarios')

const PROOF_FILE = process.env.COLONY_PROOF_FILE || '.data/colony-proof.json'

// Estados de um cenário. PASS só com evidência completa e validada.
const SCENARIO_STATUS = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  PASS: 'PASS',
  FAIL: 'FAIL',
  SKIPPED: 'SKIPPED',
  BLOCKED: 'BLOCKED'
})
const MAX_SCENARIO_HISTORY = 50
const MAX_EVIDENCE_BYTES = 8 * 1024

class ScenarioError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// Evidência vai para o navegador e para o log: sem campos sensíveis e com tamanho limitado.
function safeEvidence(value) {
  const cleaned = redact(value && typeof value === 'object' ? value : { value })
  let json
  try {
    json = JSON.stringify(cleaned)
  } catch {
    return { error: 'evidência não serializável' }
  }
  if (Buffer.byteLength(json) > MAX_EVIDENCE_BYTES) return { truncated: true, bytes: Buffer.byteLength(json) }
  return JSON.parse(json)
}

class RunVerifier {
  constructor({ eventLog = null, storage = null, botManager = null, projectManager = null, scenarios = SCENARIOS } = {}) {
    this.eventLog = eventLog || getEventLog()
    this.storage = storage
    this.botManager = botManager
    this.projectManager = projectManager
    this.proof = null
    // Cenários ao vivo: catálogo fixo, histórico só desta sessão (memória).
    this.scenarios = new Map(scenarios.map((scenario) => [scenario.id, scenario]))
    this.scenarioContext = null
    this.scenarioRuns = []
    this.currentRun = null
    this._runSeq = 0
  }

  setScenarioContext(context) {
    this.scenarioContext = context
  }

  listScenarios() {
    return [...this.scenarios.values()].map((scenario) => {
      const last = this.scenarioRuns.find((run) => run.scenarioId === scenario.id)
      return {
        id: scenario.id,
        title: scenario.title,
        action: scenario.action,
        status: last ? last.status : SCENARIO_STATUS.PENDING,
        lastRunId: last ? last.runId : null
      }
    })
  }

  scenarioState() {
    return {
      catalog: this.listScenarios(),
      current: this.currentRun ? this._publicRun(this.currentRun) : null,
      history: this.scenarioRuns.map((run) => this._publicRun(run))
    }
  }

  getScenarioRun(runId) {
    const run = this.scenarioRuns.find((item) => item.runId === runId)
    return run ? this._publicRun(run) : null
  }

  /**
   * Inicia um cenário do catálogo. Só aceita ids conhecidos; um por vez.
   * Devolve o registro já em RUNNING (ou BLOCKED/SKIPPED); o resultado chega
   * depois em scenarioState().
   */
  startScenario(id) {
    const scenario = typeof id === 'string' && this.scenarios.has(id) ? this.scenarios.get(id) : null
    if (!scenario) throw new ScenarioError('unknown', 'cenário desconhecido')
    if (this.currentRun) throw new ScenarioError('busy', `cenário ${this.currentRun.scenarioId} em andamento`)
    if (!this.scenarioContext) throw new ScenarioError('unavailable', 'contexto de teste indisponível')

    const context = this.scenarioContext
    const run = {
      runId: `run-${Date.now()}-${++this._runSeq}`,
      scenarioId: scenario.id,
      title: scenario.title,
      action: scenario.action,
      bot: context.bot?.username || null,
      status: SCENARIO_STATUS.PENDING,
      preconditions: [],
      evidence: null,
      reasons: [],
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      durationMs: null
    }
    this.scenarioRuns.unshift(run)
    if (this.scenarioRuns.length > MAX_SCENARIO_HISTORY) this.scenarioRuns.length = MAX_SCENARIO_HISTORY
    this._logScenario(run)

    let preconditions
    try {
      preconditions = (scenario.preconditions?.(context) || []).map((check) => ({
        name: String(check.name),
        ok: Boolean(check.ok),
        skip: Boolean(check.skip),
        detail: check.detail == null ? '' : String(check.detail)
      }))
    } catch (err) {
      preconditions = [{ name: 'pré-condições', ok: false, skip: false, detail: err.message }]
    }
    run.preconditions = preconditions
    const unmet = preconditions.filter((check) => !check.ok)
    if (unmet.length) {
      const skip = unmet.every((check) => check.skip)
      this._finish(run, skip ? SCENARIO_STATUS.SKIPPED : SCENARIO_STATUS.BLOCKED, unmet.map((check) => `${check.name}: ${check.detail}`))
      return this._publicRun(run)
    }

    run.status = SCENARIO_STATUS.RUNNING
    run.startedAt = new Date().toISOString()
    this.currentRun = run
    this._logScenario(run)
    run.promise = this._execute(scenario, run, context)
    return this._publicRun(run)
  }

  async _execute(scenario, run, context) {
    let cancelled = false
    const isCancelled = () => cancelled
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        cancelled = true
        reject(new Error(`tempo esgotado (${scenario.timeoutMs} ms)`))
      }, scenario.timeoutMs || 30000)
    })
    try {
      const evidence = await Promise.race([Promise.resolve().then(() => scenario.run(context, isCancelled)), timeout])
      run.evidence = safeEvidence(evidence)
      const missing = (scenario.required || []).filter((field) => run.evidence?.[field] === undefined || run.evidence?.[field] === null)
      if (run.evidence?.truncated) {
        this._finish(run, SCENARIO_STATUS.FAIL, ['evidência grande demais para validar'])
      } else if (missing.length) {
        this._finish(run, SCENARIO_STATUS.FAIL, missing.map((field) => `evidência ausente: ${field}`))
      } else {
        const reasons = (scenario.validate?.(run.evidence) || []).map(String)
        this._finish(run, reasons.length ? SCENARIO_STATUS.FAIL : SCENARIO_STATUS.PASS, reasons)
      }
    } catch (err) {
      this._finish(run, SCENARIO_STATUS.FAIL, [err.message || String(err)])
    } finally {
      clearTimeout(timer)
      cancelled = true
      if (this.currentRun === run) this.currentRun = null
    }
  }

  _finish(run, status, reasons = []) {
    run.status = status
    run.reasons = reasons.slice(0, 20).map((reason) => String(reason).slice(0, 300))
    run.finishedAt = new Date().toISOString()
    run.durationMs = run.startedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : 0
    this._logScenario(run)
  }

  _logScenario(run) {
    this.eventLog.log('scenario_status', {
      runId: run.runId,
      scenarioId: run.scenarioId,
      status: run.status,
      reasons: run.reasons,
      durationMs: run.durationMs
    }, run.bot)
  }

  _publicRun(run) {
    const { promise, ...data } = run
    return JSON.parse(JSON.stringify(data))
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

module.exports = { RunVerifier, PROOF_FILE, SCENARIO_STATUS, ScenarioError }
