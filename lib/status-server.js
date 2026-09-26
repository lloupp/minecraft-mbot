// lib/status-server.js
// Rich HTTP status server for the colony.
// Serves colony state, worker details, project progress, and recent events.
//
// Inspired by minecraft-agent's HTTP server in agent.mjs (lines 32-33)
// and nether-agent.mjs (line 22), which expose comprehensive game state
// via HTTP endpoints. Extended here for the multi-worker colony context.

const fs = require('fs')
const http = require('http')
const path = require('path')
const { getEventLog } = require('./event-log')

const DEFAULT_PORT = Number(process.env.STATUS_PORT || 3080)
const HOST = '127.0.0.1'

// Painel de testes (MBOT_DASHBOARD=1): arquivos fixos, nada de caminho vindo da URL.
const DASHBOARD_DIR = path.join(__dirname, 'dashboard')
const DASHBOARD_FILES = {
  '/dashboard': ['index.html', 'text/html; charset=utf-8'],
  '/dashboard/': ['index.html', 'text/html; charset=utf-8'],
  '/dashboard/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/dashboard/style.css': ['style.css', 'text/css; charset=utf-8']
}
const SCENARIO_RUN_PATH = /^\/api\/scenarios\/([a-z0-9_]{1,40})\/run$/
const MAX_BODY_BYTES = 1024

class StatusServer {
  constructor({ botManager, storage, projectManager, eventLog = null, port = DEFAULT_PORT, dashboard = null } = {}) {
    this._port = port
    this.botManager = botManager
    this.storage = storage
    this.projectManager = projectManager
    this.eventLog = eventLog || getEventLog()
    // { runVerifier, snapshot(), views() } — só com o painel ligado.
    this.dashboard = dashboard
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

        if (this.dashboard && (pathname in DASHBOARD_FILES || pathname.startsWith('/api/'))) {
          this._handleDashboard(req, res, pathname)
          return
        }

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

  // Rotas do painel. Diferente das rotas JSON antigas: sem CORS aberto, só com
  // Host de loopback (contra DNS rebinding) e POST só da própria página.
  _handleDashboard(req, res, pathname) {
    const send = (status, body, type = 'application/json; charset=utf-8', extra = {}) => {
      res.writeHead(status, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        ...extra
      })
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
    }

    if (!this._allowedHost(req.headers.host)) {
      send(403, { error: 'host não permitido' })
      return
    }

    if (pathname in DASHBOARD_FILES) {
      if (req.method !== 'GET') return send(405, { error: 'método não permitido' })
      const [file, type] = DASHBOARD_FILES[pathname]
      const extra = file === 'index.html' ? { 'Content-Security-Policy': this._csp(), 'X-Frame-Options': 'DENY' } : {}
      send(200, fs.readFileSync(path.join(DASHBOARD_DIR, file)), type, extra)
      return
    }

    if (pathname === '/api/snapshot' && req.method === 'GET') {
      send(200, this._getSnapshot())
      return
    }
    if (pathname === '/api/scenarios' && req.method === 'GET') {
      send(200, this.dashboard.runVerifier?.scenarioState?.() || { catalog: [], current: null, history: [] })
      return
    }

    const match = SCENARIO_RUN_PATH.exec(pathname)
    if (match && req.method === 'POST') {
      // Um site qualquer aberto no navegador não consegue mandar este cabeçalho
      // sem preflight, e o preflight não é respondido com permissão.
      if (req.headers['x-mbot-dashboard'] !== '1' || !this._allowedOrigin(req.headers.origin)) {
        send(403, { error: 'origem não permitida' })
        return
      }
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) req.destroy()
      })
      req.on('end', () => {
        try {
          const run = this.dashboard.runVerifier.startScenario(match[1])
          send(202, run)
        } catch (err) {
          const status = { unknown: 404, busy: 409, unavailable: 503 }[err.code] || 500
          send(status, { error: err.message })
        }
      })
      return
    }

    send(404, { error: 'Not found' })
  }

  _loopbackHosts() {
    const port = this._server?.address()?.port ?? this.port
    return [`127.0.0.1:${port}`, `localhost:${port}`]
  }

  _allowedHost(host) {
    return this._loopbackHosts().includes(String(host || '').toLowerCase())
  }

  _allowedOrigin(origin) {
    if (!origin) return true
    return this._loopbackHosts().some((host) => origin === `http://${host}`)
  }

  _csp() {
    const views = this.dashboard.views?.() || {}
    const frames = [views.viewer, views.inventory]
      .filter((view) => view?.status === 'ativo' && view.port)
      .flatMap((view) => [`http://127.0.0.1:${view.port}`, `http://localhost:${view.port}`])
    return [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "connect-src 'self'",
      "img-src 'self' data:",
      `frame-src ${frames.length ? frames.join(' ') : "'none'"}`,
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'"
    ].join('; ')
  }

  _getSnapshot() {
    let snapshot
    try {
      snapshot = this.dashboard.snapshot?.() || {}
    } catch (err) {
      snapshot = { error: err.message }
    }
    return {
      ...snapshot,
      project: this._getProjects()[0] || null,
      storage: this._getStorage(),
      events: {
        total: this.eventLog.size,
        recent: this.eventLog.getRecent(100)
      },
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    }
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
      return this.storage.cachedSummary?.() || {}
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
