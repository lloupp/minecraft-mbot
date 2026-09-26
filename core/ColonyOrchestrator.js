class ColonyOrchestrator {
  constructor({ botManager, homeProvider, ownerProvider, intervalMs = 5000, logger = console }) {
    this.botManager = botManager
    this.homeProvider = homeProvider
    this.ownerProvider = ownerProvider
    this.intervalMs = intervalMs
    this.logger = logger
    this.auto = false
    this.timer = null
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => this.tick().catch((err) => {
      this.logger.log(`[colônia] erro no modo automático: ${err.message}`)
    }), this.intervalMs)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  setAuto(enabled) {
    this.auto = Boolean(enabled)
    return this.auto
  }

  workers(role = null) {
    const normalized = role ? this.botManager.normalizeRole(role) : null
    return [...this.botManager.workers.values()]
      .filter((worker) => !normalized || worker.role === normalized)
  }

  controllers(role = null) {
    return this.workers(role)
      .map((worker) => ({ worker, controller: worker.bot.colonyController }))
      .filter((entry) => entry.controller)
  }

  taskSummary() {
    return this.controllers().map(({ worker, controller }) => ({
      name: worker.name,
      role: worker.role,
      state: controller.state,
      task: controller.currentTask?.type || null,
      resource: controller.currentTask?.resource || null
    }))
  }

  async assign(role, resource, count = 1) {
    const normalized = this.botManager.normalizeRole(role)
    if (!normalized) throw new Error(`papel desconhecido: ${role}`)
    const candidates = this.controllers(normalized)
    if (!candidates.length) throw new Error(`não há bots com papel ${normalized}`)

    const total = Math.max(1, Number.parseInt(count, 10) || 1)
    const base = Math.floor(total / candidates.length)
    let remainder = total % candidates.length
    const assignments = []

    for (const { worker, controller } of candidates) {
      const share = base + (remainder-- > 0 ? 1 : 0)
      if (share <= 0) continue
      const task = this.taskFor(normalized, resource, share)
      controller.run(task)
        .then((result) => this.logger.log(`[colônia] ${worker.name} terminou ${task.type}:`, result))
        .catch((err) => this.logger.log(`[colônia] ${worker.name} falhou: ${err.message}`))
      assignments.push({ name: worker.name, task })
    }
    return assignments
  }

  taskFor(role, resource, count) {
    switch (role) {
      case 'minerador':
      case 'lenhador':
        return { type: 'coletar_blocos', resource, count }
      case 'fazendeiro':
        return { type: 'fazenda', resource: resource || 'comida', count }
      case 'explorador':
        return { type: 'explorar', radius: Math.max(16, count || 64) }
      case 'guarda':
        return { type: 'guardar', durationMs: Math.max(10000, count * 1000) }
      case 'construtor':
        if (['casa', 'house', 'abrigo'].includes(String(resource || '').toLowerCase())) {
          return { type: 'construir_casa' }
        }
        throw new Error('construtor entende nesta etapa: casa/abrigo')
      case 'ajudante':
        return { type: 'voltar' }
      default:
        throw new Error(`papel sem executor: ${role}`)
    }
  }

  async buildHouse() {
    const builders = this.controllers('construtor')
    if (!builders.length) throw new Error('não há construtor na colônia')
    const chosen = builders.find(({ controller }) => controller.isIdle()) || builders[0]
    chosen.controller.run({ type: 'construir_casa' })
      .then((result) => this.logger.log(`[colônia] ${chosen.worker.name} terminou casa:`, result))
      .catch((err) => this.logger.log(`[colônia] ${chosen.worker.name} falhou na casa: ${err.message}`))
    return chosen.worker.name
  }

  async returnAll() {
    const assignments = []
    for (const { worker, controller } of this.controllers()) {
      controller.cancel()
      controller.run({ type: 'voltar' })
        .catch((err) => this.logger.log(`[colônia] ${worker.name} não voltou: ${err.message}`))
      assignments.push(worker.name)
    }
    return assignments
  }

  async tick() {
    if (!this.auto) return
    for (const { worker, controller } of this.controllers()) {
      if (!controller.isIdle()) continue
      const task = this.autoTask(worker.role)
      if (!task) continue
      controller.run(task)
        .then((result) => this.logger.log(`[auto] ${worker.name}:`, result))
        .catch((err) => this.logger.log(`[auto] ${worker.name}: ${err.message}`))
    }
  }

  autoTask(role) {
    switch (role) {
      case 'minerador':
        return { type: 'coletar_blocos', resource: 'carvao', count: 4 }
      case 'lenhador':
        return { type: 'coletar_blocos', resource: 'madeira', count: 4 }
      case 'fazendeiro':
        return { type: 'fazenda', resource: 'comida', count: 2 }
      case 'explorador':
        return { type: 'explorar', radius: 96 }
      case 'guarda':
        return { type: 'guardar', durationMs: 15000 }
      case 'ajudante':
        return { type: 'voltar' }
      default:
        return null
    }
  }
}

module.exports = { ColonyOrchestrator }
