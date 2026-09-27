'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ACTIVE = new Set(['pending', 'running', 'interrupted'])
const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function safeId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,120}$/.test(value)
}

class TaskCheckpointStore {
  constructor(filePath = process.env.MBOT_TASK_CHECKPOINT_FILE || '.data/task-checkpoints.json') {
    this.filePath = path.resolve(filePath)
    this.state = { version: 1, tasks: {}, updatedAt: null }
    this._write = Promise.resolve()
    this.lastLoadError = null
  }

  async load() {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(this.filePath, 'utf8'))
      if (!parsed || parsed.version !== 1 || typeof parsed.tasks !== 'object' || Array.isArray(parsed.tasks)) {
        const err = new Error('checkpoint incompatível')
        err.code = 'CHECKPOINT_SCHEMA_UNSUPPORTED'
        throw err
      }
      this.state = { version: 1, tasks: {}, updatedAt: parsed.updatedAt || null }
      for (const [id, raw] of Object.entries(parsed.tasks)) {
        if (!safeId(id) || !raw || typeof raw !== 'object') continue
        const status = raw.status === 'running' ? 'interrupted' : raw.status
        if (![...ACTIVE, ...TERMINAL].includes(status)) continue
        this.state.tasks[id] = {
          ...clone(raw),
          id,
          status,
          recoveryRequired: status === 'interrupted' ? true : Boolean(raw.recoveryRequired)
        }
      }
      return this.snapshot()
    } catch (err) {
      if (err.code === 'ENOENT') return this.snapshot()
      if (err instanceof SyntaxError || err.code === 'CHECKPOINT_SCHEMA_UNSUPPORTED') {
        this.lastLoadError = err
        return this.snapshot()
      }
      throw err
    }
  }

  create({ id = null, worker, action, args = {}, objective = null, stateHash = null }) {
    const taskId = id || crypto.randomUUID()
    if (!safeId(taskId)) throw new Error('task id inválido')
    if (!safeId(worker)) throw new Error('worker inválido')
    const now = new Date().toISOString()
    const task = {
      id: taskId,
      worker,
      action,
      args: clone(args),
      objective,
      stateHash,
      status: 'pending',
      attempts: 0,
      result: null,
      recoveryRequired: false,
      createdAt: now,
      updatedAt: now
    }
    this.state.tasks[taskId] = task
    return clone(task)
  }

  start(id, { stateHash = null } = {}) {
    const task = this.require(id)
    if (TERMINAL.has(task.status)) throw new Error('checkpoint já finalizado')
    task.status = 'running'
    task.attempts += 1
    task.stateHash = stateHash || task.stateHash
    task.recoveryRequired = false
    task.updatedAt = new Date().toISOString()
    return clone(task)
  }

  finish(id, result) {
    const task = this.require(id)
    task.status = result?.success ? 'completed'
      : result?.reason === 'cancelled' ? 'cancelled'
        : 'failed'
    task.result = clone(result)
    task.recoveryRequired = false
    task.updatedAt = new Date().toISOString()
    return clone(task)
  }

  interrupt(id, reason = 'process_interrupted') {
    const task = this.require(id)
    if (TERMINAL.has(task.status)) return clone(task)
    task.status = 'interrupted'
    task.recoveryRequired = true
    task.result = { success: false, reason }
    task.updatedAt = new Date().toISOString()
    return clone(task)
  }

  require(id) {
    const task = this.state.tasks[id]
    if (!task) throw new Error('checkpoint não encontrado')
    return task
  }

  recoverable(worker = null) {
    return Object.values(this.state.tasks)
      .filter(task => task.status === 'interrupted' && (!worker || task.worker === worker))
      .map(clone)
  }

  snapshot() {
    return clone(this.state)
  }

  async save() {
    if (this.lastLoadError) {
      const err = new Error('salvamento bloqueado: arquivo de checkpoint inválido')
      err.code = 'CHECKPOINT_RECOVERY_REQUIRED'
      throw err
    }
    const data = this.snapshot()
    data.updatedAt = new Date().toISOString()
    const run = async () => {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.tmp-${process.pid}`
      try {
        await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
        const check = JSON.parse(await fs.promises.readFile(tmp, 'utf8'))
        if (check.version !== 1) throw new Error('checkpoint temporário inválido')
        await fs.promises.rename(tmp, this.filePath)
      } finally {
        await fs.promises.rm(tmp, { force: true })
      }
      this.state.updatedAt = data.updatedAt
      return data
    }
    this._write = this._write.then(run, run)
    return this._write
  }
}

module.exports = { TaskCheckpointStore, ACTIVE, TERMINAL }
