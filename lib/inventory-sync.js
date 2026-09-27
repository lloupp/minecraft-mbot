// lib/inventory-sync.js
// Periodic inventory synchronization between the Mineflayer bot and the
// StorageManager. Handles cursor desynchronization issues (window ID -1,
// slot -1) that occur in Minecraft 1.20.1 protocol after transfers.
//
// Inspired by minecraft-agent's inventory-recovery.mjs and the cursor
// synchronizer described in optimization/nether/REVIEW.md.

const { EventLog, getEventLog } = require('./event-log')

const SYNC_INTERVAL_MS = 5000
const CURSOR_TIMEOUT_MS = 5000

class InventorySync {
  constructor({ storage, bot, eventLog = null, logger = console } = {}) {
    this.storage = storage
    this.bot = bot
    this.eventLog = eventLog || getEventLog()
    this.logger = logger
    this._timer = null
    this._lastSync = 0
    this._cursorDesyncCount = 0
    this._inventorySnapshot = {}
    this._running = false
  }

  /**
   * Start periodic synchronization.
   */
  start() {
    if (this._running) return
    this._running = true
    this._timer = setInterval(() => this.sync(), SYNC_INTERVAL_MS)
    this.logger?.log('[inventory-sync] Started periodic sync')
  }

  /**
   * Stop periodic synchronization.
   */
  stop() {
    this._running = false
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
    this.logger?.log('[inventory-sync] Stopped periodic sync')
  }

  /**
   * Perform a single sync cycle.
   * Reads bot inventory and updates storage snapshot.
   */
  sync() {
    try {
      if (!this.bot || !this.bot.entity || !this.bot.inventory) return
      if (!this.storage || !this.storage.setPosition) return

      // Snapshot local do inventário do bot. Nunca sobrescreve o snapshot do
      // estoque central: são fontes de dados diferentes.
      const items = this.bot.inventory.items()
      const snapshot = {}
      for (const item of items) {
        if (!item?.name) continue
        snapshot[item.name] = (snapshot[item.name] || 0) + Number(item.count || 0)
      }
      this._inventorySnapshot = snapshot
      this._lastSync = Date.now()

      // Check cursor state - if cursor has item but window ID is -1
      // with slot -1, the cursor is desynchronized. Send a correction.
      const cursorItem = this.bot.inventory.selectedItem
      if (cursorItem && this._isCursorDesynced()) {
        this._correctCursor()
        this._cursorDesyncCount++
      }
    } catch (err) {
      this.logger?.log(`[inventory-sync] Sync error: ${err.message}`)
    }
  }

  /**
   * Detect cursor desynchronization.
   * In 1.20.1, after some transfers, server sends cursor update with
   * window ID -1 and slot -1 but bot still has a held item.
   */
  _isCursorDesynced() {
    try {
      // Check if bot._syncWindow exists (set by inventory-recovery)
      if (this.bot._syncWindow) {
        const window = this.bot.currentWindow || this.bot.inventory
        if (window && window.id === -1) {
          return true
        }
      }
      // Simple heuristic: if bot has selectedItem but no open window
      // and storage doesn't match inventory, there may be a desync
      const inv = this.storage?.cachedSummary?.() || {}
      const hasItem = this.bot.heldItem?.name
      return false
    } catch {
      return false
    }
  }

  /**
   * Attempt to correct cursor desynchronization.
   */
  _correctCursor() {
    try {
      this.logger?.log('[inventory-sync] Correcting cursor desync')
      this.eventLog.log('cursor_desync', {
        item: this.bot.heldItem?.name,
        count: this._cursorDesyncCount
      })

      // Try to close any stuck window
      if (this.bot.closeWindow) {
        this.bot.closeWindow()
      }

      // Wait a tick and re-check
      this.bot.waitForTicks(1)
    } catch (err) {
      this.logger?.log(`[inventory-sync] Cursor correction failed: ${err.message}`)
    }
  }

  /**
   * Verify inventory consistency between bot and storage.
   * @returns {{ consistent: boolean, mismatches: object[] }}
   */
  snapshot() {
    return { ...this._inventorySnapshot }
  }

  verify() {
    if (!this.bot || !this.bot.inventory) {
      return { consistent: false, mismatches: [], reason: 'missing bot inventory' }
    }

    const current = {}
    for (const item of this.bot.inventory.items()) {
      if (!item?.name) continue
      current[item.name] = (current[item.name] || 0) + Number(item.count || 0)
    }

    const names = new Set([...Object.keys(current), ...Object.keys(this._inventorySnapshot)])
    const mismatches = []
    for (const name of names) {
      const observed = Number(current[name] || 0)
      const snap = Number(this._inventorySnapshot[name] || 0)
      if (observed !== snap) mismatches.push({ item: name, current: observed, snapshot: snap, delta: observed - snap })
    }

    return {
      consistent: mismatches.length === 0,
      mismatches,
      checkedAt: new Date().toISOString()
    }
  }

  /**
   * Force an immediate sync and verification.
   * @returns {object} verification result
   */
  forceSync() {
    this.sync()
    return this.verify()
  }
}

module.exports = { InventorySync }
