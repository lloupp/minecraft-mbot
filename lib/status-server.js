// lib/status-server.js
// Rich HTTP status server for the colony.
// Serves colony state, worker details, project progress, and recent events.
//
// Inspired by minecraft-agent's HTTP server in agent.mjs (lines 32-33)
// and nether-agent.mjs (line 22), which expose comprehensive game state
// via HTTP endpoints. Extended here for the multi-worker colony context.

const http = require('http')
const { EventLog, getEventLog } = require('./event-log')

const DEFAULT_PORT = Number(process.env.STATUS_PORT || 3080)
const HOST = '127.0.0.1'

class StatusServer {
  constructor({ botManager, storage, projectManager, eventLog = null, port = DEFAULT_PORT } = {}) {
    this._port = port
    this.botManager = botManager
    this.storage = storage
    this.projectManager = projectManager
    this.eventLog = eventLog || getEventLog()
    this._server = null
    this._running = false
  }

  /**
   * Start the status server.
   */
  start() {
    if (this._running) return
    this._running = true

    this._server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url, `http://${HOST}`)
        const pathname = url.pathname
        const method = req.method

        // CORS for local access
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Content-Type', 'application/json')

        if (method === 'OPTIONS') {
          res.writeHead(200)
          res.end()
          return
        }

        let result

        if (pathname === '/' || pathname === '/status') {
          result = this._getStatus()
        } else if (pathname === '/workers') {
          result = this._getWorkers()
        } else if (pathname.startsWith('/worker/')) {
          const name = pathname.slice('/worker/'.length)
          result = this._getWorker(name)
        } else if (pathname === '/projects') {
          result = this._getProjects()
        } else if (pathname.startsWith('/project/')) {
          const id = pathname.slice('/project/'.length)
          result = this._getProject(id)
        } else if (pathname === '/storage') {
          result = this._getStorage()
        } else if (pathname === '/events') {
          const limit = parseInt(url.searchParams.get('limit') || '100')
          result = this._getEvents(limit)
        } else if (pathname === '/health') {
          result = { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() }
        } else {
          res.writeHead(404)
          res.end(JSON.stringify({ error: 'Not found' }))
          return
        }

        res.writeHead(200)
        res.end(JSON.stringify(result, null, 2))
      } catch (err) {
        res.writeHead(500)
        res.end(JSON.stringify({ error: err.message }))
      }
    })

    this._server.listen(this.port, HOST, () => {
      this.logger?.(`[status-server] Listening on ${HOST}:${this.port}`)
    })
  }

  /**
   * Stop the status server.
   */
  stop() {
    this._running = false
    if (this._server) {
      this._server.close()
      this._server = null
    }
  }

  /**
   * Get full colony status.
   * @private
   */
  _getStatus() {
    const workers = this._getWorkers()
    const projects = this._getProjects()
    const storage = this._getStorage()
    const stats = this.eventLog.size > 0 ? { totalEvents: this.eventLog.size } : {}

    return {
      colony: {
        name: 'minecraft-mbot',
        startTime: new Date().toISOString(),
        uptime: Math.floor(process.uptime())
      },
      workers,
      projects,
      storage,
      events: stats,
      health: 'ok',
      timestamp: new Date().toISOString()
    }
  }

  /**
   * Get all workers.
   * @private
   */
  _getWorkers() {
    if (!this.botManager) return []
    const list = this.botManager.list?.() || []
    return list.map(w => ({
      name: w.name,
      role: w.role,
      status: w.status || 'active',
      health: w.health || 20,
      food: w.food || null,
      position: w.position || null,
      inventory: w.inventory || {},
      lastEvent: w.lastEvent || null
    }))
  }

  /**
   * Get a single worker.
   * @private
   */
  _getWorker(name) {
    if (!this.botManager) return null
    const worker = this.botManager.get?.(name) || this.botManager.list?.().find(w => w.name === name)
    if (!worker) return null
    return {
      name: worker.name,
      role: worker.role,
      status: worker.status || 'active',
      health: worker.health || 20,
      position: worker.position || null,
      inventory: worker.inventory || {},
      tasks: worker.tasks || [],
      events: this.eventLog.getEvents({ worker: name, limit: 50 })
    }
  }

  /**
   * Get all projects.
   * @private
   */
  _getProjects() {
    if (!this.projectManager) return []
    const status = this.projectManager.status?.() || []
    return Array.isArray(status) ? status : [status].filter(Boolean)
  }

  /**
   * Get a single project.
   * @private
   */
  _getProject(id) {
    if (!this.projectManager) return null
    const project = this.projectManager.get?.(id)
    return project || null
  }

  /**
   * Get storage summary.
   * @private
   */
  _getStorage() {
    if (!this.storage) return null
    try {
      const summary = this.storage.summary?.() || this.storage.cachedSummary?.() || {}
      return summary
    } catch {
      return null
    }
  }

  /**
   * Get recent events.
   * @private
   */
  _getEvents(limit) {
    return this.eventLog.getRecent(limit)
  }

  /**
   * Get the server port.
   */
  get port() { return this._port }
}

module.exports = { StatusServer }
