const PROJECT_DEFINITIONS = {
  casa: {
    label: 'Casa',
    requiredRoles: { minerador: 1, lenhador: 1, artesao: 1, construtor: 1 },
    targets: {
      building: 64,
      wood: 24,
      food: 32,
      fuel: 16,
      ironTotal: 24,
      ironIngot: 8,
      ironPickaxe: 1,
      ironAxe: 1
    },
    actions: [
      { id: 'casa-1', role: 'construtor', task: { type: 'construir_casa', offset: { x: 5, z: 2 } } }
    ]
  },
  fazenda: {
    label: 'Fazenda',
    requiredRoles: { lenhador: 1, fazendeiro: 1, artesao: 1 },
    targets: {
      food: 96,
      wood: 64,
      fuel: 24,
      ironTotal: 32,
      ironIngot: 12,
      ironAxe: 1
    },
    actions: []
  },
  mina: {
    label: 'Mina',
    requiredRoles: { minerador: 2, lenhador: 1, artesao: 1, guarda: 1 },
    targets: {
      food: 48,
      wood: 64,
      fuel: 48,
      ironTotal: 96,
      ironIngot: 24,
      building: 96,
      ironPickaxe: 4,
      ironAxe: 1,
      ironSword: 1
    },
    actions: []
  },
  vila: {
    label: 'Vila',
    requiredRoles: {
      minerador: 2,
      lenhador: 2,
      fazendeiro: 1,
      artesao: 1,
      construtor: 1,
      guarda: 1,
      explorador: 1
    },
    targets: {
      food: 128,
      wood: 256,
      fuel: 64,
      ironTotal: 96,
      ironIngot: 32,
      building: 256,
      ironPickaxe: 4,
      ironAxe: 2,
      ironSword: 2
    },
    actions: [
      { id: 'vila-casa-1', role: 'construtor', task: { type: 'construir_casa', offset: { x: 5, z: 2 } } },
      { id: 'vila-casa-2', role: 'construtor', task: { type: 'construir_casa', offset: { x: 11, z: 2 } } },
      { id: 'vila-casa-3', role: 'construtor', task: { type: 'construir_casa', offset: { x: 5, z: 8 } } }
    ]
  }
}

function mergeTargets(base = {}, extra = {}) {
  const out = { ...base }
  for (const [key, value] of Object.entries(extra || {})) {
    out[key] = Math.max(Number(out[key] || 0), Number(value || 0))
  }
  return out
}

class ProjectManager {
  constructor({ storage = null, homeProvider = null } = {}) {
    this.storage = storage
    this.homeProvider = homeProvider
    this.active = null
    this.history = []
  }

  types() {
    return Object.keys(PROJECT_DEFINITIONS)
  }

  definition(type) {
    return PROJECT_DEFINITIONS[String(type || '').toLowerCase()] || null
  }

  start(type) {
    const normalized = String(type || '').toLowerCase()
    const definition = this.definition(normalized)
    if (!definition) throw new Error(`projeto desconhecido: ${type}`)
    if (!this.homeProvider?.()) throw new Error('defina a base primeiro com !base aqui')
    if (!this.storage?.configured?.()) throw new Error('defina o estoque primeiro com !estoque aqui')

    if (this.active && this.active.status === 'ativo') {
      throw new Error(`já existe projeto ativo: ${this.active.type}`)
    }

    this.active = {
      type: normalized,
      label: definition.label,
      status: 'ativo',
      startedAt: Date.now(),
      completedAt: null,
      actions: definition.actions.map((action) => ({
        id: action.id,
        role: action.role,
        task: JSON.parse(JSON.stringify(action.task)),
        status: 'pendente',
        attempts: 0,
        lastError: null
      }))
    }
    return this.status()
  }

  cancel() {
    if (!this.active) return null
    this.active.status = 'cancelado'
    this.active.completedAt = Date.now()
    this.history.push(this.active)
    const result = this.status()
    this.active = null
    return result
  }

  isActive() {
    return Boolean(this.active && this.active.status === 'ativo')
  }

  targets() {
    if (!this.active) return {}
    return { ...this.definition(this.active.type).targets }
  }

  requiredRoles() {
    if (!this.active) return {}
    return { ...(this.definition(this.active.type).requiredRoles || {}) }
  }

  pendingActions() {
    if (!this.isActive()) return []
    return this.active.actions.filter((action) => action.status === 'pendente')
  }

  inProgressActions() {
    if (!this.isActive()) return []
    return this.active.actions.filter((action) => action.status === 'executando')
  }

  actionReady(report) {
    if (!report) return false
    return Object.values(report.deficits || {}).every((value) => Number(value || 0) === 0)
  }

  planActions(workers, report) {
    if (!this.isActive() || !this.actionReady(report)) return []
    const idleByRole = new Map()
    for (const entry of workers) {
      if (!entry.controller?.isIdle?.()) continue
      if (!idleByRole.has(entry.worker.role)) idleByRole.set(entry.worker.role, [])
      idleByRole.get(entry.worker.role).push(entry)
    }

    const planned = []
    for (const action of this.pendingActions()) {
      const candidates = idleByRole.get(action.role) || []
      const entry = candidates.shift()
      if (!entry) continue
      action.status = 'executando'
      action.attempts++
      planned.push({
        ...entry,
        task: {
          ...action.task,
          projectActionId: action.id,
          projectType: this.active.type,
          reason: `projeto_${this.active.type}`
        }
      })
    }
    return planned
  }

  completeAction(id, result) {
    if (!this.isActive()) return
    const action = this.active.actions.find((entry) => entry.id === id)
    if (!action) return
    if (result?.ok === false) {
      action.status = 'pendente'
      action.lastError = 'resultado sem sucesso'
      return
    }
    action.status = 'concluido'
    action.lastError = null
  }

  failAction(id, error) {
    if (!this.isActive()) return
    const action = this.active.actions.find((entry) => entry.id === id)
    if (!action) return
    action.status = 'pendente'
    action.lastError = error?.message || String(error || 'erro desconhecido')
  }

  maybeComplete(report) {
    if (!this.isActive() || !this.actionReady(report)) return false
    if (this.pendingActions().length || this.inProgressActions().length) return false
    this.active.status = 'concluido'
    this.active.completedAt = Date.now()
    this.history.push(this.active)
    return true
  }

  archiveCompleted() {
    if (this.active?.status !== 'concluido') return null
    const result = this.status()
    this.active = null
    return result
  }

  status(report = null) {
    if (!this.active) return null
    const actions = this.active.actions.map((action) => ({
      id: action.id,
      role: action.role,
      status: action.status,
      attempts: action.attempts,
      lastError: action.lastError
    }))
    return {
      type: this.active.type,
      label: this.active.label,
      status: this.active.status,
      startedAt: this.active.startedAt,
      completedAt: this.active.completedAt,
      targets: this.targets(),
      requiredRoles: this.requiredRoles(),
      deficits: report?.deficits ? { ...report.deficits } : null,
      actions
    }
  }
}

module.exports = { ProjectManager, PROJECT_DEFINITIONS, mergeTargets }
