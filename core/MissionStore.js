// core/MissionStore.js
// Estado durável de missões. Diferente de RequestQueue, guarda o grafo, as
// evidências e as tentativas por nó. Reinício converte `running` em
// `interrupted`; nenhuma ação física é repetida sem pedido explícito.

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const STATUSES = new Set(['pending', 'running', 'paused', 'completed', 'failed', 'cancelled', 'interrupted'])
const TERMINAL = new Set(['completed', 'failed', 'cancelled'])
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_MISSIONS = 100

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function safeId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,120}$/.test(value)
}

function validGraph(graph) {
  return Array.isArray(graph) && graph.length > 0 && graph.every((node) =>
    node && safeId(String(node.id || '')) && typeof node.action === 'string')
}

class MissionStore {
  constructor(filePath = process.env.MBOT_MISSION_FILE || '.data/missions.json') {
    this.filePath = path.resolve(filePath)
    this.state = { version: 1, missions: Object.create(null), updatedAt: null }
    this.lastLoadError = null
    this._write = Promise.resolve()
  }

  async load() {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(this.filePath, 'utf8'))
      if (!parsed || parsed.version !== 1 || !parsed.missions || typeof parsed.missions !== 'object' || Array.isArray(parsed.missions)) {
        const err = new Error('arquivo de missões incompatível')
        err.code = 'MISSION_SCHEMA_UNSUPPORTED'
        throw err
      }
      const missions = Object.create(null)
      for (const [id, raw] of Object.entries(parsed.missions)) {
        if (!safeId(id) || !raw || typeof raw !== 'object') continue
        if (!validGraph(raw.graph)) continue
        if (!STATUSES.has(raw.status)) continue
        const interrupted = raw.status === 'running'
        missions[id] = {
          ...clone(raw),
          id,
          status: interrupted ? 'interrupted' : raw.status,
          recoveryRequired: interrupted ? true : Boolean(raw.recoveryRequired),
          nodeAttempts: raw.nodeAttempts && typeof raw.nodeAttempts === 'object' ? clone(raw.nodeAttempts) : {},
          evidence: Array.isArray(raw.evidence) ? clone(raw.evidence) : []
        }
      }
      this.state = { version: 1, missions, updatedAt: parsed.updatedAt || null }
      this.lastLoadError = null
      return this.snapshot()
    } catch (err) {
      if (err.code === 'ENOENT') return this.snapshot()
      if (err instanceof SyntaxError || err.code === 'MISSION_SCHEMA_UNSUPPORTED') {
        // Preserva o arquivo: um autosave não pode apagar a única evidência.
        this.lastLoadError = err
        return this.snapshot()
      }
      throw err
    }
  }

  snapshot() {
    return clone(this.state)
  }

  list() {
    return Object.values(this.state.missions)
      .map((mission) => clone(mission))
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
  }

  get(id) {
    const mission = this.state.missions[String(id)]
    return mission ? clone(mission) : null
  }

  active() {
    return this.list().filter((mission) => ['pending', 'running', 'paused', 'interrupted'].includes(mission.status))
  }

  create({ id = null, spec = {}, graph, status = 'pending', now = new Date().toISOString() }) {
    const missionId = id == null ? crypto.randomUUID() : String(id)
    if (!safeId(missionId)) throw new Error('mission id inválido')
    if (Object.hasOwn(this.state.missions, missionId)) throw new Error('mission id já existe')
    if (!validGraph(graph)) throw new Error('grafo de missão inválido')
    if (!STATUSES.has(status)) throw new Error('status de missão inválido')
    const mission = {
      id: missionId,
      spec: clone(spec || {}),
      graph: clone(graph),
      status,
      evidence: [],
      lastError: null,
      nodeAttempts: {},
      createdAt: now,
      updatedAt: now
    }
    this.state.missions[missionId] = mission
    return clone(mission)
  }

  update(id, patch = {}) {
    const mission = this.state.missions[String(id)]
    if (!mission) throw new Error('missão não encontrada')
    if (patch.status != null && !STATUSES.has(patch.status)) throw new Error('status de missão inválido')
    for (const key of ['spec', 'graph', 'status', 'evidence', 'lastError', 'nodeAttempts', 'recoveryRequired']) {
      if (patch[key] !== undefined) mission[key] = clone(patch[key])
    }
    mission.updatedAt = new Date().toISOString()
    return clone(mission)
  }

  setStatus(id, status, extra = {}) {
    return this.update(id, { ...extra, status })
  }

  prune({ now = Date.now(), maxAgeMs = MAX_AGE_MS, maxMissions = MAX_MISSIONS } = {}) {
    const entries = Object.entries(this.state.missions)
    for (const [id, mission] of entries) {
      if (!TERMINAL.has(mission.status)) continue
      const updated = Date.parse(mission.updatedAt || mission.createdAt || '')
      if (Number.isFinite(updated) && now - updated > maxAgeMs) delete this.state.missions[id]
    }
    const remaining = Object.values(this.state.missions)
    if (remaining.length <= maxMissions) return this.list()
    const removable = remaining
      .filter((mission) => TERMINAL.has(mission.status))
      .sort((a, b) => String(a.updatedAt || a.createdAt || '').localeCompare(String(b.updatedAt || b.createdAt || '')))
    for (const mission of removable) {
      if (Object.keys(this.state.missions).length <= maxMissions) break
      delete this.state.missions[mission.id]
    }
    return this.list()
  }

  async save() {
    if (this.lastLoadError) {
      const err = new Error('salvamento bloqueado: preserve e recupere o arquivo de missões inválido')
      err.code = 'MISSION_RECOVERY_REQUIRED'
      throw err
    }
    const run = async () => {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.tmp-${process.pid}`
      const data = { ...this.snapshot(), updatedAt: new Date().toISOString() }
      try {
        await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
        const written = JSON.parse(await fs.promises.readFile(tmp, 'utf8'))
        if (written.version !== 1) throw new Error('versão inválida no arquivo temporário de missões')
        await fs.promises.rename(tmp, this.filePath)
      } finally {
        await fs.promises.rm(tmp, { force: true })
      }
      return data
    }
    this._write = this._write.then(run, run)
    return this._write
  }
}

module.exports = { MissionStore, STATUSES, TERMINAL, MAX_AGE_MS, MAX_MISSIONS, validGraph }
