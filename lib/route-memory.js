// lib/route-memory.js
// Waypoint memory system with metadata tracking.
// Waypoints gain type, completion status, visit history, and resource
// collection records. Prevents redundant resource collection.
//
// Inspired by minecraft-agent's seedRoute and routeIndex in agent.mjs,
// where the bot tracks its position along a fixed route and skips
// already-visited waypoints. Extended here to support dynamic colony
// waypoints with completion tracking.

const fs = require('fs')
const path = require('path')

class RouteMemory {
  constructor(storage = null) {
    this.storage = storage
    this._waypoints = new Map() // id -> { type, completed, lastVisited, resources, position }
    this._visited = new Set()
  }

  /**
   * Register or update a waypoint.
   * @param {string} id - Unique waypoint identifier
   * @param {object} position - { x, y, z }
   * @param {object} [meta] - { type, resources }
   */
  register(id, position, meta = {}) {
    const wp = this._waypoints.get(id)
    const existing = wp ? { ...wp } : null

    this._waypoints.set(id, {
      id,
      position: { x: Math.floor(position.x), y: Math.floor(position.y), z: Math.floor(position.z) },
      type: meta.type || 'generic',
      completed: existing?.completed || false,
      lastVisited: existing?.lastVisited || null,
      resources: meta.resources || existing?.resources || [],
      resourcesCollected: existing?.resourcesCollected || [],
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })

    if (existing) {
      this._visited.add(id)
    }
  }

  /**
   * Mark a waypoint as visited.
   * @param {string} id
   * @param {object} [resourcesCollected] - Items collected at this waypoint
   */
  visit(id, resourcesCollected = []) {
    const wp = this._waypoints.get(id)
    if (!wp) return

    wp.lastVisited = new Date().toISOString()
    wp.resourcesCollected = [...new Set([...wp.resourcesCollected, ...resourcesCollected])]

    // Auto-complete if all declared resources collected
    if (wp.resources.length > 0 && wp.resources.every(r => wp.resourcesCollected.includes(r))) {
      wp.completed = true
    }

    this._visited.add(id)
    this._waypoints.set(id, wp)
  }

  /**
   * Mark a waypoint as complete regardless of resource collection.
   * @param {string} id
   */
  complete(id) {
    const wp = this._waypoints.get(id)
    if (!wp) return
    wp.completed = true
    wp.lastVisited = new Date().toISOString()
    this._visited.add(id)
    this._waypoints.set(id, wp)
  }

  /**
   * Get all waypoints, optionally filtered.
   * @param {object} [filter] - { type?: string, completed?: boolean }
   * @returns {object[]}
   */
  getAll(filter = {}) {
    let waypoints = Array.from(this._waypoints.values())
    if (filter.type) waypoints = waypoints.filter(w => w.type === filter.type)
    if (filter.completed !== undefined) waypoints = waypoints.filter(w => w.completed === filter.completed)
    return waypoints
  }

  /**
   * Get incomplete waypoints of a given type (for workers to visit).
   * @param {string} [type] - Optional type filter
   * @returns {object[]}
   */
  getIncomplete(type = null) {
    let waypoints = this.getAll()
    waypoints = waypoints.filter(w => !w.completed)
    if (type) waypoints = waypoints.filter(w => w.type === type)
    // Sort by lastVisited (never visited first)
    waypoints.sort((a, b) => (a.lastVisited || '').localeCompare(b.lastVisited || ''))
    return waypoints
  }

  /**
   * Get resources already collected at a waypoint.
   * @param {string} id
   * @returns {string[]}
   */
  getCollected(id) {
    const wp = this._waypoints.get(id)
    return wp?.resourcesCollected || []
  }

  /**
   * Get resources still needed at a waypoint (declared minus collected).
   * @param {string} id
   * @returns {string[]}
   */
  getRemaining(id) {
    const wp = this._waypoints.get(id)
    if (!wp) return []
    return wp.resources.filter(r => !wp.resourcesCollected.includes(r))
  }

  /**
   * Check if a waypoint has been visited.
   * @param {string} id
   * @returns {boolean}
   */
  isVisited(id) { return this._visited.has(id) }

  /**
   * Check if a waypoint is complete.
   * @param {string} id
   * @returns {boolean}
   */
  isComplete(id) {
    const wp = this._waypoints.get(id)
    return wp?.completed || false
  }

  /**
   * Get waypoint by position (nearest match within range).
   * @param {object} pos - { x, y, z }
   * @param {number} [range=32]
   * @returns {object|null}
   */
  getNearest(pos, range = 32) {
    let nearest = null
    let nearestDist = range

    for (const wp of this._waypoints.values()) {
      const dist = Math.hypot(wp.position.x - pos.x, wp.position.y - pos.y, wp.position.z - pos.z)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = wp
      }
    }
    return nearest
  }

  /**
   * Remove completed waypoints older than a threshold.
   * @param {number} [maxAgeMs=86400000] - Default 24 hours
   */
  pruneOld(maxAgeMs = 86400000) {
    const cutoff = Date.now() - maxAgeMs
    for (const [id, wp] of this._waypoints) {
      if (wp.completed && wp.lastVisited && new Date(wp.lastVisited).getTime() < cutoff) {
        this._waypoints.delete(id)
        this._visited.delete(id)
      }
    }
  }

  /**
   * Get statistics about route memory.
   * @returns {object}
   */
  get stats() {
    const all = this.getAll()
    return {
      total: all.length,
      completed: all.filter(w => w.completed).length,
      incomplete: all.filter(w => !w.completed).length,
      visited: this._visited.size,
      byType: all.reduce((acc, w) => { acc[w.type] = (acc[w.type] || 0) + 1; return acc }, {})
    }
  }

  /**
   * Persist route memory to storage.
   */
  persist() {
    if (!this.storage) return
    const data = {
      waypoints: this.getAll(),
      visited: Array.from(this._visited),
      updatedAt: new Date().toISOString()
    }
    this.storage.set('routeMemory', data)
  }

  /**
   * Load route memory from storage.
   */
  load() {
    if (!this.storage) return
    const data = this.storage.get('routeMemory')
    if (data && data.waypoints) {
      for (const wp of data.waypoints) {
        this._waypoints.set(wp.id, wp)
        if (wp.lastVisited) this._visited.add(wp.id)
      }
    }
  }
}

module.exports = { RouteMemory }
