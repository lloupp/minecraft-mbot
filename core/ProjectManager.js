const { stockMetrics } = require('./DemandPlanner')

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
    actions: [
      { id: 'fazenda-fisica', role: 'fazendeiro', task: { type: 'construir_fazenda', offset: { x: 8, z: 8 } } }
    ]
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
    actions: [
      { id: 'mina-fisica', role: 'minerador', task: { type: 'construir_mina', length: 12 } }
    ]
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
      { id: 'vila-casa-3', role: 'construtor', task: { type: 'construir_casa', offset: { x: 5, z: 8 } } },
      { id: 'vila-fazenda', role: 'fazendeiro', task: { type: 'construir_fazenda', offset: { x: 12, z: 8 } } },
      { id: 'vila-mina', role: 'minerador', task: { type: 'construir_mina', length: 10 } }
    ]
  }
}

const MAX_BLUEPRINT_ATTEMPTS = 4

function sumMaterials(list) {
  const out = {}
  for (const materials of list) {
    for (const [name, count] of Object.entries(materials || {})) {
      out[name] = (out[name] || 0) + Number(count || 0)
    }
  }
  return out
}

// Projeto de planta: definição montada na hora (não é fixa como casa/vila).
// Cada fatia da planta vira uma obra de construtor com o material que ela usa.
function blueprintDefinition({ name, origin, size = null, regions = [], builders = null }) {
  const count = Math.max(1, Number(builders) || regions.length || 1)
  return {
    label: `Planta ${name}`,
    blueprint: {
      name,
      origin: { x: Math.floor(origin.x), y: Math.floor(origin.y), z: Math.floor(origin.z) },
      size: size ? { ...size } : null
    },
    requiredRoles: { construtor: count, minerador: 1, lenhador: 1, artesao: 1 },
    targets: {},
    actions: regions.map((entry, index) => ({
      id: `planta-${index + 1}`,
      role: 'construtor',
      task: {
        type: 'construir_planta',
        planta: name,
        origin: { x: Math.floor(origin.x), y: Math.floor(origin.y), z: Math.floor(origin.z) },
        region: entry.region ? { ...entry.region } : null,
        materials: { ...(entry.materials || {}) }
      }
    }))
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
    const normalized = String(type || '').toLowerCase()
    if (normalized === 'planta') return this.active?.type === 'planta' ? this.active.definition : null
    return PROJECT_DEFINITIONS[normalized] || null
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

  startBlueprint(options) {
    if (!this.homeProvider?.()) throw new Error('defina a base primeiro com !base aqui')
    if (!this.storage?.configured?.()) throw new Error('defina o estoque primeiro com !estoque aqui')
    if (this.active && this.active.status === 'ativo') {
      throw new Error(`já existe projeto ativo: ${this.active.type}`)
    }
    const definition = blueprintDefinition(options)
    if (!definition.actions.length) throw new Error('planta sem blocos para construir')
    this.active = {
      type: 'planta',
      label: definition.label,
      definition,
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

  restore(state) {
    if (state?.type === 'planta' && state.blueprint) return this.restoreBlueprint(state)
    if (!state || !state.type || !this.definition(state.type)) return false
    const definition = this.definition(state.type)
    this.active = {
      type: state.type,
      label: definition.label,
      status: state.status === 'concluido' ? 'concluido' : 'ativo',
      startedAt: Number(state.startedAt) || Date.now(),
      completedAt: state.completedAt ? Number(state.completedAt) : null,
      actions: definition.actions.map((action) => {
        const saved = (state.actions || []).find((entry) => entry.id === action.id)
        return {
          id: action.id,
          role: action.role,
          task: JSON.parse(JSON.stringify(action.task)),
          status: saved?.status === 'concluido' ? 'concluido' : 'pendente',
          attempts: Number(saved?.attempts || 0),
          lastError: saved?.lastError || null
        }
      })
    }
    return true
  }

  restoreBlueprint(state) {
    const definition = blueprintDefinition({
      ...state.blueprint,
      regions: (state.actions || []).map((action) => ({
        region: action.task?.region || null,
        materials: action.task?.materials || {}
      }))
    })
    if (!definition.actions.length) return false
    this.active = {
      type: 'planta',
      label: definition.label,
      definition,
      status: state.status === 'concluido' ? 'concluido' : 'ativo',
      startedAt: Number(state.startedAt) || Date.now(),
      completedAt: state.completedAt ? Number(state.completedAt) : null,
      actions: definition.actions.map((action, index) => {
        const saved = state.actions[index] || {}
        return {
          id: action.id,
          role: action.role,
          task: JSON.parse(JSON.stringify(action.task)),
          status: saved.status === 'concluido' ? 'concluido' : 'pendente',
          attempts: Number(saved.attempts || 0),
          lastError: saved.lastError || null
        }
      })
    }
    return true
  }

  exportState() {
    if (!this.active) return null
    if (this.active.type === 'planta') {
      return {
        type: 'planta',
        status: this.active.status,
        startedAt: this.active.startedAt,
        completedAt: this.active.completedAt,
        blueprint: { ...this.active.definition.blueprint, builders: this.active.definition.requiredRoles.construtor },
        actions: this.active.actions.map((action) => ({
          id: action.id,
          status: action.status,
          attempts: action.attempts,
          lastError: action.lastError,
          task: JSON.parse(JSON.stringify(action.task))
        }))
      }
    }
    return {
      type: this.active.type,
      status: this.active.status,
      startedAt: this.active.startedAt,
      completedAt: this.active.completedAt,
      actions: this.active.actions.map((action) => ({
        id: action.id,
        status: action.status,
        attempts: action.attempts,
        lastError: action.lastError
      }))
    }
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
    if (!this.isActive()) return {}
    if (this.active.type === 'planta') {
      // Categorias do planejador (construção/madeira) a partir do material das
      // obras que ainda vão começar: mineradores e lenhadores trabalham para elas.
      const metrics = stockMetrics(this.materialTargets())
      const out = {}
      if (metrics.building > 0) out.building = metrics.building
      if (metrics.wood > 0) out.wood = metrics.wood
      return out
    }
    return { ...this.definition(this.active.type).targets }
  }

  // Material (item -> quantidade) das obras de planta pendentes.
  materialTargets() {
    if (!this.isActive() || this.active.type !== 'planta') return {}
    return sumMaterials(this.pendingActions().map((action) => action.task.materials))
  }

  // Material das obras pendentes que o estoque ainda não cobre.
  missingMaterials(stock = {}) {
    const out = {}
    for (const [name, count] of Object.entries(this.materialTargets())) {
      const lack = count - Number(stock[name] || 0)
      if (lack > 0) out[name] = lack
    }
    return out
  }

  // Obra de planta só começa com o material da fatia no estoque, descontando o
  // que outras obras planejadas no mesmo ciclo já reservaram.
  materialsReady(action, stock, reserved) {
    for (const [name, count] of Object.entries(action.task.materials || {})) {
      if (Number(stock?.[name] || 0) - Number(reserved[name] || 0) < count) return false
    }
    for (const [name, count] of Object.entries(action.task.materials || {})) {
      reserved[name] = (reserved[name] || 0) + count
    }
    return true
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
    if (!this.isActive()) return []
    const blueprintMode = this.active.type === 'planta'
    if (!blueprintMode && !this.actionReady(report)) return []
    const reserved = {}
    const idleByRole = new Map()
    for (const entry of workers) {
      if (!entry.controller?.isIdle?.()) continue
      if (!idleByRole.has(entry.worker.role)) idleByRole.set(entry.worker.role, [])
      idleByRole.get(entry.worker.role).push(entry)
    }

    const planned = []
    for (const action of this.pendingActions()) {
      const candidates = idleByRole.get(action.role) || []
      if (!candidates.length) continue
      if (blueprintMode && !this.materialsReady(action, report?.stock, reserved)) continue
      const entry = candidates.shift()
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
      // Planta: a próxima tentativa só precisa do que faltou nesta.
      if (action.task.type === 'construir_planta' && result.remaining) {
        action.task.materials = { ...result.remaining }
        const missing = Object.keys(result.missing || {})
        if (missing.length) action.lastError = `sem material: ${missing.join(', ')}`
        else if (result.failed) action.lastError = `${result.failed} blocos falharam`
        // Blocos inalcançáveis não melhoram com insistência: desiste da fatia.
        if (!missing.length && action.attempts >= MAX_BLUEPRINT_ATTEMPTS) action.status = 'falhou'
      }
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
    if (!this.isActive()) return false
    // Planta termina quando as obras terminam; as metas de estoque são só meio.
    if (this.active.type !== 'planta' && !this.actionReady(report)) return false
    if (this.active.actions.some((action) => action.status !== 'concluido')) return false
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
      targets: this.active.type === 'planta' ? this.targets() : { ...this.definition(this.active.type).targets },
      requiredRoles: { ...(this.definition(this.active.type).requiredRoles || {}) },
      deficits: report?.deficits ? { ...report.deficits } : null,
      blueprint: this.active.definition?.blueprint ? { ...this.active.definition.blueprint } : null,
      materials: this.materialTargets(),
      missingMaterials: report?.stock ? this.missingMaterials(report.stock) : null,
      actions
    }
  }
}

module.exports = { ProjectManager, PROJECT_DEFINITIONS, mergeTargets, blueprintDefinition, sumMaterials }
