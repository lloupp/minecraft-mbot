// lib/death-recovery.js
// When a worker dies, save death position and last known inventory,
// then attempt to recover dropped items.
//
// Inspired by minecraft-agent's death handling (agent.mjs line 37):
//   bot.on('death', ()=>{dead=true; log('death',{state:snapshot()});stopped=true;})
// and inventory-recovery.mjs, but adapted for the worker colony context.

const { getEventLog } = require('./event-log')
const { Vec3 } = require('vec3')
const { goals } = require('mineflayer-pathfinder')

const RECOVERY_RANGE = 24
const RECOVERY_TIMEOUT_MS = 10000
const DEATH_COOLDOWN_MS = 30000

class DeathRecovery {
  constructor({ storage, eventLog = null, logger = console } = {}) {
    this.storage = storage
    this.eventLog = eventLog || getEventLog()
    this.logger = logger
    this._log = typeof logger === 'function' ? logger : (logger?.log || console.log)
    this._deathPositions = new Map() // botName -> { position, time, inventory }
    this._lastDeathTime = new Map() // botName -> timestamp
  }

  /**
   * Record a worker death. Saves position and inventory for recovery.
   * @param {string} workerName
   * @param {object} position - { x, y, z }
   * @param {object} inventory - Last known inventory snapshot
   */
  recordDeath(workerName, position, inventory) {
    const now = Date.now()
    // Check cooldown - if worker died within cooldown, don't auto-recover
    const lastDeath = this._lastDeathTime.get(workerName) || 0
    if (lastDeath && now - lastDeath < DEATH_COOLDOWN_MS) {
      this._log(`[death-recovery] ${workerName} death ignored (cooldown)`)
      return { recovered: false, reason: 'cooldown' }
    }

    this._deathPositions.set(workerName, {
      position: { x: Math.floor(position.x), y: Math.floor(position.y), z: Math.floor(position.z) },
      inventory: { ...inventory },
      time: new Date().toISOString()
    })
    this._lastDeathTime.set(workerName, now)

    this.eventLog.log('worker_death', {
      worker: workerName,
      position: { x: position.x, y: position.y, z: position.z },
      inventorySnapshot: inventory
    }, workerName)

    this._log(`[death-recovery] ${workerName} death recorded at ${position.x},${position.y},${position.z}`)
    return { recovered: false, reason: 'recorded', position: this._deathPositions.get(workerName) }
  }

  /**
   * Attempt to recover items dropped at the death position.
   * @param {object} bot - Mineflayer bot instance
   * @param {string} workerName
   * @returns {Promise<{recovered: string[], failed: string[]}>}
   */
  async recover(bot, workerName) {
    const deathRecord = this._deathPositions.get(workerName)
    if (!deathRecord) {
      return { recovered: [], failed: [], reason: 'no_death_record' }
    }

    const pos = deathRecord.position
    const recovered = []
    const failed = []

    // Find nearby dropped items
    const drops = Object.values(bot.entities)
      .filter(e => e.name === 'item' && e.getDroppedItem)
      .filter(e => e.position.distanceTo(new Vec3(pos.x, pos.y, pos.z)) <= RECOVERY_RANGE)
      .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))

    for (const drop of drops) {
      try {
        const itemName = drop.getDroppedItem()?.name
        if (!itemName) continue

        const before = bot.inventory?.items?.()
          .filter((item) => item.name === itemName)
          .reduce((sum, item) => sum + Number(item.count || 0), 0) || 0

        // Item drop é entidade, não bloco; caminhar até ele é suficiente para pickup.
        await bot.pathfinder.goto(new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 1), RECOVERY_TIMEOUT_MS)
        bot.pathfinder.setGoal(null)
        bot.clearControlStates?.()
        await bot.waitForTicks?.(5)

        const after = bot.inventory?.items?.()
          .filter((item) => item.name === itemName)
          .reduce((sum, item) => sum + Number(item.count || 0), 0) || 0
        if (after > before) recovered.push(itemName)
        else failed.push(itemName)
      } catch (err) {
        failed.push(drop.getDroppedItem()?.name || 'unknown')
        this._log(`[death-recovery] Failed to recover drop at ${pos.x},${pos.y},${pos.z}: ${err.message}`)
      }
    }

    // Update the death record
    this._deathPositions.set(workerName, { ...deathRecord, recovered, failed })

    this.eventLog.log('death_recovery', {
      worker: workerName,
      position: pos,
      recovered,
      failed,
      itemsRemaining: deathRecord.inventory
    }, workerName)

    this._log(`[death-recovery] ${workerName}: recovered [${recovered.join(', ')}], failed [${failed.join(', ')}]`)
    return { recovered, failed }
  }

  /**
   * Get the death record for a worker (for resuming after restart).
   * @param {string} workerName
   * @returns {object|null}
   */
  getDeathRecord(workerName) {
    return this._deathPositions.get(workerName) || null
  }

  /**
   * Clear death record after successful recovery.
   * @param {string} workerName
   */
  clearDeathRecord(workerName) {
    this._deathPositions.delete(workerName)
  }

  /**
   * Get all recorded deaths.
   * @returns {Map<string, object>}
   */
  get allDeaths() { return new Map(this._deathPositions) }

  /**
   * Get total death count.
   * @returns {number}
   */
  get deathCount() { return this._deathPositions.size }
}

module.exports = { DeathRecovery }
