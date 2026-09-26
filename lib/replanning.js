// lib/replanning.js
// Replanning engine that decides when to request a new plan from the
// colony planner, based on meaningful changes in state.
//
// Inspired by minecraft-agent's planTrigger() (optimization/policy.mjs):
//   - initial
//   - dimension_changed
//   - inventory_milestone_changed
//   - repeated_failure
//   - waypoint_reached
//   - periodic_review
//   - no_useful_actions
//
// and asyncPlanner (async-planner.mjs) for background planning.

const { EventLog, getEventLog } = require('./event-log')

const DEFAULT_INTERVAL_MS = 15000
const REPEAT_FAILURE_THRESHOLD = 2
const REPEAT_FAILURE_COOLDOWN_MS = 10000
const WAYPOINT_REACH_COOLDOWN_MS = 5000
const PERIODIC_REVIEW_MS = 120000

class ReplanningEngine {
  constructor({ storage, eventLog = null, logger = console } = {}) {
    this.storage = storage
    this.eventLog = eventLog || getEventLog()
    this.logger = logger
    this._lastStage = null
    this._lastPlanAt = 0
    this._errors = 0
    this._pending = null
    this._timer = null
    this._running = false
    this._lastActionResult = null
    this._consecutiveFailures = 0
  }

  /**
   * Start the replanning engine. Calls the provided plan function
   * when a trigger condition is met.
   * @param {function} planFn - Async function returning a plan
   * @param {function} onPlan - Callback when plan is ready
   * @param {object} [options] - { intervalMs, thresholds }
   */
  start(planFn, onPlan, options = {}) {
    const intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS
    const onPlanCallback = onPlan || (() => {})

    this._planFn = planFn
    this._onPlan = onPlanCallback
    this._running = true

    this._timer = setInterval(() => this._checkAndPlan(), intervalMs)
    this.logger?.log('[replanning] Engine started')
  }

  /**
   * Stop the replanning engine.
   */
  stop() {
    this._running = false
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
    this.logger?.log('[replanning] Engine stopped')
  }

  /**
   * Record an action result (success/failure) to inform replanning.
   * @param {boolean} success
   * @param {string} [actionKey]
   */
  recordResult(success, actionKey = null) {
    if (success) {
      this._consecutiveFailures = 0
      this._lastActionResult = { success: true, actionKey, time: Date.now() }
    } else {
      this._consecutiveFailures++
      this._errors++
      this._lastActionResult = { success: false, actionKey, time: Date.now() }
    }
  }

  /**
   * Record that the bot moved to a new dimension.
   */
  recordDimensionChange(dimension) {
    this._lastDimension = dimension
  }

  /**
   * Record that a waypoint was reached.
   * @param {object} waypoint
   */
  recordWaypointReached(waypoint) {
    this._lastWaypoint = waypoint
    this._lastWaypointAt = Date.now()
  }

  /**
   * Get the replanning trigger reason.
   * @param {object} state - Current colony state
   * @returns {string|null} Trigger reason or null
   */
  getTrigger(state) {
    if (!this._lastStage) return 'initial'

    // Stage changed (new dimension, new phase)
    if (state.stage && state.stage !== this._lastStage) {
      return 'dimension_changed'
    }

    // Inventory milestone changed (major item count changed)
    if (this._hasInventoryMilestoneChanged(state)) {
      return 'inventory_milestone'
    }

    // Repeated failures
    if (this._consecutiveFailures >= REPEAT_FAILURE_THRESHOLD &&
        Date.now() - this._lastPlanAt > REPEAT_FAILURE_COOLDOWN_MS) {
      return 'repeated_failure'
    }

    // Waypoint reached
    if (this._lastWaypoint && Date.now() - this._lastWaypointAt > WAYPOINT_REACH_COOLDOWN_MS) {
      return 'waypoint_reached'
    }

    // Periodic review
    if (Date.now() - this._lastPlanAt > PERIODIC_REVIEW_MS) {
      return 'periodic_review'
    }

    // No useful actions available
    if (this._consecutiveFailures >= 3 && this._errors > 0) {
      return 'no_useful_actions'
    }

    return null
  }

  /**
   * Check conditions and trigger replanning if needed.
   * @private
   */
  async _checkAndPlan() {
    if (!this._planFn || !this._running) return
    if (this._pending) return // Already planning

    const state = this._getState()
    const reason = this.getTrigger(state)

    if (!reason) return

    this._lastStage = state.stage
    this._lastPlanAt = Date.now()
    this._consecutiveFailures = 0

    this.logger?.log(`[replanning] Trigger: ${reason}, planning...`)
    this.eventLog.log('planner_request', { reason, stage: state.stage }, 'orchestrator')

    this._pending = true
    try {
      const result = await this._planFn(state)
      this._pending = false
      if (this._onPlan) this._onPlan(result, reason)
      this.eventLog.log('planner_ready', { reason, stage: state.stage }, 'orchestrator')
    } catch (err) {
      this._pending = false
      this.logger?.log(`[replanning] Plan failed: ${err.message}`)
      this.eventLog.log('planner_error', { reason, error: err.message }, 'orchestrator')
    }
  }

  /**
   * Get a simplified state for replanning decisions.
   * @private
   */
  _getState() {
    if (!this.storage) return { stage: 'unknown' }
    const summary = this.storage.cachedSummary() || {}
    return {
      stage: this._inferStage(summary),
      inventory: summary,
      workers: this._getWorkerStates()
    }
  }

  /**
   * Infer current colony stage from inventory.
   * @private
   */
  _inferStage(summary) {
    const beds = summary.bed || summary.beds || 0
    const ironPick = summary.iron_pickaxe || 0
    const obsidian = summary.obsidian || 0
    if (beds >= 8 && ironPick > 0 && obsidian >= 12) return 'travel'
    if (ironPick > 0 && obsidian >= 12) return 'prepare'
    return 'basic'
  }

  /**
   * Check if inventory milestone has changed significantly.
   * @private
   */
  _hasInventoryMilestoneChanged(state) {
    if (!this.storage) return false
    const current = this.storage.cachedSummary() || {}
    const previous = this._lastInventory || {}
    this._lastInventory = current

    for (const [key, value] of Object.entries(current)) {
      const prev = previous[key] || 0
      // Milestone: item count doubled or dropped by more than half
      if (value > 0 && prev > 0 && (value >= prev * 2 || value <= Math.floor(prev / 2))) {
        return true
      }
      // New item appeared
      if (value > 0 && prev === 0 && key.length > 3) {
        return true
      }
    }
    return false
  }

  /**
   * Get worker states summary.
   * @private
   */
  _getWorkerStates() {
    // This will be populated by the ColonyOrchestrator
    return []
  }

  /**
   * Get whether a plan is currently pending.
   */
  get pending() { return this._pending }

  /**
   * Get the number of consecutive failures.
   */
  get failureCount() { return this._consecutiveFailures }

  /**
   * Get total errors.
   */
  get errors() { return this._errors }
}

module.exports = { ReplanningEngine }
