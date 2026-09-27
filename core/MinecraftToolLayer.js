'use strict'

const crypto = require('node:crypto')

const MAX_COUNT = 64
const MAX_COORD = 30000000

const TOOLS = Object.freeze({
  get_state: { kind: 'read', args: {} },
  get_inventory: { kind: 'read', args: {} },
  get_position: { kind: 'read', args: {} },
  get_available_actions: { kind: 'read', args: {} },
  get_current_task: { kind: 'read', args: {} },
  stop: { kind: 'primitive', args: {} },
  eat: { kind: 'task', args: {} },
  move_to: { kind: 'primitive', args: { position: 'position' } },
  gather: { kind: 'task', args: { resource: 'name', quantity: 'count' } },
  craft: { kind: 'task', args: { item: 'name', quantity: 'count' } },
  deposit: { kind: 'task', args: {} },
  withdraw: { kind: 'task', args: { item: 'name', quantity: 'count' } }
})

function inventory(bot) {
  const out = {}
  for (const item of bot?.inventory?.items?.() || []) out[item.name] = (out[item.name] || 0) + item.count
  return out
}

function position(bot) {
  const p = bot?.entity?.position
  return p ? { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } : null
}

function safeName(value) {
  return typeof value === 'string' && /^[a-z0-9_:-]{1,80}$/i.test(value)
}

function validatePosition(value) {
  if (!value || typeof value !== 'object') return false
  return ['x', 'y', 'z'].every(k => Number.isFinite(Number(value[k])) && Math.abs(Number(value[k])) <= MAX_COORD)
}

function validateArgs(spec, args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'args_invalid'
  for (const [key, type] of Object.entries(spec.args)) {
    const value = args[key]
    if (type === 'name' && !safeName(value)) return `invalid_${key}`
    if (type === 'count' && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > MAX_COUNT)) return `invalid_${key}`
    if (type === 'position' && !validatePosition(value)) return `invalid_${key}`
  }
  return null
}

class MinecraftToolLayer {
  constructor({ worker, workerId, logger = console, maxFailures = 3, checkpointStore = null }) {
    if (!worker || !workerId) throw new Error('worker e workerId são obrigatórios')
    this.worker = worker
    this.workerId = workerId
    this.logger = logger
    this.maxFailures = maxFailures
    this.checkpointStore = checkpointStore
    this.lastAction = null
    this.lastResult = null
    this.consecutiveFailures = 0
  }

  availableActions() {
    const actions = ['get_state', 'get_inventory', 'get_position', 'get_available_actions', 'get_current_task', 'stop']
    if (this.worker.bot?.entity) actions.push('eat', 'move_to', 'gather')
    if (this.worker.production) actions.push('craft')
    if (this.worker.storage?.configured?.()) actions.push('deposit', 'withdraw')
    return actions
  }

  state(objective = null) {
    const bot = this.worker.bot
    const actions = this.availableActions()
    return {
      worker: this.workerId,
      health: Number(bot?.health ?? 0),
      food: Number(bot?.food ?? 0),
      position: position(bot),
      dimension: bot?.game?.dimension || null,
      inventory: inventory(bot),
      equipped: bot?.heldItem?.name || null,
      objective,
      currentTask: this.worker.currentTask ? { ...this.worker.currentTask } : null,
      availableActions: actions,
      busy: !this.worker.isIdle(),
      cancellationRequested: false,
      lastAction: this.lastAction,
      lastResult: this.lastResult,
      consecutiveFailures: this.consecutiveFailures
    }
  }

  validate(decision) {
    if (!decision || typeof decision !== 'object') return 'decision_invalid'
    if (decision.worker && decision.worker !== this.workerId) return 'worker_mismatch'
    if (!TOOLS[decision.action]) return 'unknown_action'
    if (!this.availableActions().includes(decision.action)) return 'action_unavailable'
    return validateArgs(TOOLS[decision.action], decision.args)
  }

  async execute(decision) {
    const reason = this.validate(decision)
    if (reason) return this.record(decision?.action || null, { success: false, rejected: true, reason })
    const action = decision.action
    const args = decision.args || {}
    const before = inventory(this.worker.bot)
    const started = Date.now()
    let checkpoint = null
    if (this.checkpointStore && !action.startsWith('get_')) {
      checkpoint = this.checkpointStore.create({
        id: decision.task_id || null,
        worker: this.workerId,
        action,
        args,
        objective: decision.objective || null,
        stateHash: this.stateHash(decision.objective)
      })
      this.checkpointStore.start(checkpoint.id, { stateHash: checkpoint.stateHash })
      await this.checkpointStore.save()
    }
    try {
      let result
      if (action === 'get_state') result = this.state(decision.objective)
      else if (action === 'get_inventory') result = before
      else if (action === 'get_position') result = position(this.worker.bot)
      else if (action === 'get_available_actions') result = this.availableActions()
      else if (action === 'get_current_task') result = this.worker.currentTask ? { ...this.worker.currentTask } : null
      else if (action === 'stop') { this.worker.cancel(); result = { ok: true } }
      else if (action === 'eat') result = { ok: Boolean(await this.worker.eat()) }
      else {
        const task = this.toTask(action, args)
        result = await this.worker.run(task)
      }
      const success = this.verify(action, args, before, result)
      const payload = { success, result, duration_ms: Date.now() - started, task_id: checkpoint?.id || decision.task_id || null }
      if (checkpoint) {
        this.checkpointStore.finish(checkpoint.id, payload)
        await this.checkpointStore.save()
      }
      return this.record(action, payload)
    } catch (error) {
      const payload = { success: false, error: error.message, duration_ms: Date.now() - started, task_id: checkpoint?.id || decision.task_id || null }
      if (checkpoint) {
        this.checkpointStore.finish(checkpoint.id, payload)
        await this.checkpointStore.save()
      }
      return this.record(action, payload)
    }
  }

  toTask(action, args) {
    if (action === 'move_to') return { type: 'ir_local', position: args.position }
    if (action === 'gather') return { type: 'coletar_blocos', resource: args.resource, count: Number(args.quantity) }
    if (action === 'craft') return { type: 'fabricar', item: args.item, count: Number(args.quantity) }
    if (action === 'deposit') return { type: 'depositar' }
    if (action === 'withdraw') return { type: 'retirar_estoque', item: args.item, count: Number(args.quantity) }
    throw new Error('ação sem tarefa determinística')
  }

  verify(action, args, before, result) {
    if (action.startsWith('get_')) return true
    if (action === 'stop') return this.worker.currentTask == null
    if (action === 'eat') return Boolean(result?.ok)
    if (action === 'move_to') return Boolean(result?.ok)
    if (action === 'gather') return Boolean(result?.ok && result?.verified && result.gathered >= Number(args.quantity))
    if (action === 'craft') return Boolean(result?.ok)
    if (action === 'withdraw') return Boolean(result?.ok && result.withdrawn >= 1)
    if (action === 'deposit') return Boolean(result?.ok)
    return false
  }

  record(action, payload) {
    this.lastAction = action
    this.lastResult = payload
    this.consecutiveFailures = payload.success ? 0 : this.consecutiveFailures + 1
    const entry = { worker: this.workerId, action, ...payload }
    this.logger.log?.('[tool-api] ' + JSON.stringify(entry))
    return entry
  }

  stateHash(objective = null) {
    return crypto.createHash('sha256').update(JSON.stringify(this.state(objective))).digest('hex').slice(0, 16)
  }
}

module.exports = { MinecraftToolLayer, TOOLS, validateArgs, inventory, position }
