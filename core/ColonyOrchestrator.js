const husbandry = require('../lib/husbandry')

class ColonyOrchestrator {
  constructor({
    botManager,
    homeProvider,
    ownerProvider,
    storage = null,
    demandPlanner = null,
    projectManager = null,
    intervalMs = 5000,
    stockMaxAgeMs = 30000,
    logger = console
  }) {
    this.botManager = botManager
    this.homeProvider = homeProvider
    this.ownerProvider = ownerProvider
    this.storage = storage
    this.demandPlanner = demandPlanner
    this.projectManager = projectManager
    this.intervalMs = intervalMs
    this.stockMaxAgeMs = stockMaxAgeMs
    this.logger = logger
    this.auto = false
    this.timer = null
    this.autoBackoff = new Map()
    this.animalBackoff = new Map()
    this.animalTargets = new Map()
    // Espécies com tarefa de manejo em andamento: o backoff só é gravado no fim,
    // sem isso o tick seguinte mandaria outro fazendeiro para o mesmo curral.
    this.animalInFlight = new Set()
    this.animalFailures = new Map()
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

  autoReadiness() {
    const missing = []
    if (!this.homeProvider?.()) missing.push('base')
    if (!this.storage?.configured?.()) missing.push('estoque')
    if (!this.demandPlanner) missing.push('planejador')
    return { ready: missing.length === 0, missing }
  }

  setAnimalTarget(species, target) {
    const key = String(species || '').toLowerCase()
    if (!key) throw new Error('espécie inválida')
    const value = Math.max(2, Math.min(32, Number.parseInt(target, 10) || 2))
    this.animalTargets.set(key, value)
    return value
  }

  clearAnimalTarget(species) {
    return this.animalTargets.delete(String(species || '').toLowerCase())
  }

  restoreAnimalTargets(targets = {}) {
    this.animalTargets.clear()
    for (const [species, target] of Object.entries(targets || {})) {
      const value = Number.parseInt(target, 10)
      // Estado salvo pode ter nome antigo/inválido: guarda só a espécie canônica.
      const canonical = husbandry.normalizeSpecies(species)
      if (!canonical || !Number.isInteger(value)) continue
      this.animalTargets.set(canonical, Math.max(2, Math.min(32, value)))
    }
    return this.animalTargetsSnapshot()
  }

  animalTargetsSnapshot() {
    return Object.fromEntries(this.animalTargets)
  }

  buildAnimalPlan(eligible = []) {
    const farmers = eligible.filter(({ worker, controller }) =>
      worker.role === 'fazendeiro' &&
      controller.isIdle() &&
      typeof controller.penPopulation === 'function'
    )
    if (!farmers.length || !this.animalTargets.size) return []

    const used = new Set()
    const plan = []
    for (const [species, target] of this.animalTargets) {
      if (this.animalInFlight.has(species)) continue
      if ((this.animalBackoff.get(species) || 0) > Date.now()) continue
      const chosen = farmers.find(({ worker }) => !used.has(worker.name))
      if (!chosen) break

      const snapshot = chosen.controller.penPopulation(species)
      // Chunk do curral não carregado: não dá para saber se existe; tenta depois.
      if (snapshot?.status?.unknown) continue
      if (!snapshot?.built) {
        plan.push({
          ...chosen,
          task: {
            type: 'construir_curral',
            species,
            reason: `curral_${species}`
          }
        })
        used.add(chosen.worker.name)
        continue
      }

      if (snapshot.inside >= target) continue
      if (snapshot.inside < 2) {
        plan.push({
          ...chosen,
          task: {
            type: 'capturar_animais',
            species,
            count: Math.max(1, Math.min(target - snapshot.inside, 2 - snapshot.inside)),
            reason: `capturar_${species}`
          }
        })
      } else {
        plan.push({
          ...chosen,
          task: {
            type: 'manejar_populacao',
            species,
            target,
            reason: `manter_${species}`
          }
        })
      }
      used.add(chosen.worker.name)
    }
    return plan
  }

  demandReport() {
    if (!this.demandPlanner || !this.storage?.configured?.()) return null
    const projectTargets = this.projectManager?.targets?.() || {}
    return this.demandPlanner.report(this.storage.cachedSummary(), projectTargets)
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
      resource: controller.currentTask?.resource || null,
      item: controller.currentTask?.item || null
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
      case 'artesao':
        return { type: 'fabricar', item: resource, count }
      case 'ajudante':
        return { type: 'voltar' }
      default:
        throw new Error(`papel sem executor: ${role}`)
    }
  }

  runRoleTask(role, task, label = task.type) {
    const candidates = this.controllers(role)
    if (!candidates.length) throw new Error(`não há ${role} na colônia`)
    const chosen = candidates.find(({ controller }) => controller.isIdle()) || candidates[0]
    chosen.controller.run(task)
      .then((result) => this.logger.log(`[colônia] ${chosen.worker.name} terminou ${label}:`, result))
      .catch((err) => this.logger.log(`[colônia] ${chosen.worker.name} falhou em ${label}: ${err.message}`))
    return chosen.worker.name
  }

  async buildHouse() {
    return this.runRoleTask('construtor', { type: 'construir_casa' }, 'casa')
  }

  async buildFarm() {
    return this.runRoleTask('fazendeiro', { type: 'construir_fazenda', offset: { x: 8, z: 8 } }, 'fazenda')
  }

  async buildMine(length = 12) {
    return this.runRoleTask('minerador', { type: 'construir_mina', length }, 'mina')
  }

  async buildAnimalPen(species = 'cow', offset = null) {
    const task = { type: 'construir_curral', species, offset }
    const candidates = [
      ...this.controllers('construtor'),
      ...this.controllers('fazendeiro')
    ]
    if (!candidates.length) throw new Error('não há construtor nem fazendeiro na colônia')
    const chosen = candidates.find(({ controller }) => controller.isIdle()) || candidates[0]
    chosen.controller.run(task)
      .then((result) => this.logger.log(`[curral] ${chosen.worker.name}:`, result))
      .catch((err) => this.logger.log(`[curral] ${chosen.worker.name} falhou: ${err.message}`))
    return { name: chosen.worker.name, task }
  }

  async captureAnimals(species, count = 1) {
    const normalizedCount = Math.max(1, Math.min(16, Number.parseInt(count, 10) || 1))
    const name = this.runRoleTask(
      'fazendeiro',
      { type: 'capturar_animais', species, count: normalizedCount },
      `captura de ${species}`
    )
    return { name, species, count: normalizedCount }
  }

  async manageAnimalPopulation(species, target = 6) {
    const normalizedTarget = Math.max(2, Math.min(32, Number.parseInt(target, 10) || 6))
    const name = this.runRoleTask(
      'fazendeiro',
      { type: 'manejar_populacao', species, target: normalizedTarget },
      `manejo de ${species}`
    )
    return { name, species, target: normalizedTarget }
  }

  async breedAnimals(species, pairs = 1) {
    const normalizedPairs = Math.max(1, Math.min(16, Number.parseInt(pairs, 10) || 1))
    const name = this.runRoleTask(
      'fazendeiro',
      { type: 'reproduzir_animais', species, pairs: normalizedPairs },
      `reprodução de ${species}`
    )
    return { name, species, pairs: normalizedPairs }
  }

  async shearSheep(count = 1) {
    const normalizedCount = Math.max(1, Math.min(32, Number.parseInt(count, 10) || 1))
    const name = this.runRoleTask(
      'fazendeiro',
      { type: 'tosquiar', count: normalizedCount },
      'tosquia'
    )
    return { name, count: normalizedCount }
  }

  async exploreAt(position, radius = 64) {
    const normalizedRadius = Math.max(16, Math.min(256, Number.parseInt(radius, 10) || 64))
    const name = this.runRoleTask(
      'explorador',
      { type: 'explorar', center: { ...position }, radius: normalizedRadius },
      'exploração dirigida'
    )
    return { name, radius: normalizedRadius }
  }

  async sendTo(workerName, position) {
    const worker = this.botManager.get(workerName)
    if (!worker?.bot?.colonyController) throw new Error(`bot não encontrado: ${workerName}`)
    const task = { type: 'ir_local', position: { ...position } }
    worker.bot.colonyController.run(task)
      .then((result) => this.logger.log(`[navegação] ${workerName} chegou ao local:`, result))
      .catch((err) => this.logger.log(`[navegação] ${workerName} falhou: ${err.message}`))
    return task
  }

  async craft(item, count = 1) {
    const artisans = this.controllers('artesao')
    if (!artisans.length) throw new Error('não há artesão na colônia')
    const chosen = artisans.find(({ controller }) => controller.isIdle()) || artisans[0]
    const task = { type: 'fabricar', item, count: Math.max(1, Number.parseInt(count, 10) || 1) }
    chosen.controller.run(task)
      .then((result) => this.logger.log(`[produção] ${chosen.worker.name}:`, result))
      .catch((err) => this.logger.log(`[produção] ${chosen.worker.name} falhou: ${err.message}`))
    return { name: chosen.worker.name, task }
  }

  async supply(workerName, item, count = 1) {
    const worker = this.botManager.get(workerName)
    if (!worker?.bot?.colonyController) throw new Error(`bot não encontrado: ${workerName}`)
    const task = { type: 'retirar_estoque', item, count: Math.max(1, Number.parseInt(count, 10) || 1) }
    worker.bot.colonyController.run(task)
      .then((result) => this.logger.log(`[estoque] ${workerName} recebeu:`, result))
      .catch((err) => this.logger.log(`[estoque] ${workerName} falhou: ${err.message}`))
    return task
  }

  async depositAll() {
    const names = []
    for (const { worker, controller } of this.controllers()) {
      if (!controller.isIdle()) continue
      controller.run({ type: 'depositar' })
        .catch((err) => this.logger.log(`[estoque] ${worker.name} não depositou: ${err.message}`))
      names.push(worker.name)
    }
    return names
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

  eligibleAutoControllers() {
    const now = Date.now()
    return this.controllers().filter(({ worker, controller }) =>
      controller.isIdle() && (this.autoBackoff.get(worker.name) || 0) <= now
    )
  }

  // Falhas seguidas no manejo de uma espécie (sem ração, sem animais por perto...)
  // dobram a espera: 30 s, 1 min, 2 min... até 10 min. Um sucesso zera.
  animalFailureDelay(species) {
    const failures = (this.animalFailures.get(species) || 0) + 1
    this.animalFailures.set(species, failures)
    return Math.min(30000 * 2 ** (failures - 1), 600000)
  }

  runAuto(worker, controller, task) {
    const animalTask = task.species &&
      ['manejar_populacao', 'capturar_animais', 'construir_curral'].includes(task.type)
    if (animalTask) this.animalInFlight.add(task.species)
    controller.run(task)
      .finally(() => {
        if (animalTask) this.animalInFlight.delete(task.species)
      })
      .then((result) => {
        if (result?.ok === false) {
          this.autoBackoff.set(worker.name, Date.now() + 15000)
        } else {
          this.autoBackoff.delete(worker.name)
        }

        if (animalTask && result?.ok === false) {
          this.animalBackoff.set(task.species, Date.now() + this.animalFailureDelay(task.species))
        } else if (animalTask) {
          this.animalFailures.delete(task.species)
          if (task.type === 'manejar_populacao') this.animalBackoff.set(task.species, Date.now() + 300000)
          else this.animalBackoff.delete(task.species)
        }
        if (task.projectActionId) {
          this.projectManager?.completeAction?.(task.projectActionId, result)
          const report = this.demandReport()
          if (this.projectManager?.maybeComplete?.(report)) {
            this.logger.log(`[projeto] ${task.projectType} concluído.`)
          }
        }
        this.logger.log(`[auto] ${worker.name} ${task.reason || task.type}:`, result)
      })
      .catch((err) => {
        if (task.projectActionId) this.projectManager?.failAction?.(task.projectActionId, err)
        this.autoBackoff.set(worker.name, Date.now() + 20000)
        if (animalTask) {
          this.animalBackoff.set(task.species, Date.now() + this.animalFailureDelay(task.species))
        }
        this.logger.log(`[auto] ${worker.name}: ${err.message}`)
      })
  }

  async tick() {
    if (!this.auto) return

    const readiness = this.autoReadiness()
    if (!readiness.ready) return

    const eligible = this.eligibleAutoControllers()
    if (!eligible.length) return

    if (!this.storage.snapshotFresh(this.stockMaxAgeMs)) {
      const chosen = eligible[0]
      this.runAuto(chosen.worker, chosen.controller, {
        type: 'sincronizar_estoque',
        reason: 'atualizar_estoque'
      })
      return
    }

    const projectTargets = this.projectManager?.targets?.() || {}
    const { plan, report } = this.demandPlanner.buildPlan(
      eligible,
      this.storage.cachedSummary(),
      projectTargets
    )

    const projectPlan = this.projectManager?.planActions?.(eligible, report) || []
    const projectWorkers = new Set(projectPlan.map((entry) => entry.worker.name))
    const husbandryEligible = eligible.filter(({ worker }) => !projectWorkers.has(worker.name))
    const animalPlan = this.buildAnimalPlan(husbandryEligible)
    const animalWorkers = new Set(animalPlan.map((entry) => entry.worker.name))

    if (!projectPlan.length && this.projectManager?.maybeComplete?.(report)) {
      this.logger.log(`[projeto] ${this.projectManager.status()?.type || 'projeto'} concluído.`)
    }

    for (const { worker, controller, task } of projectPlan) {
      this.runAuto(worker, controller, task)
    }

    for (const { worker, controller, task } of animalPlan) {
      this.runAuto(worker, controller, task)
    }

    for (const { worker, controller, task } of plan) {
      if (projectWorkers.has(worker.name) || animalWorkers.has(worker.name)) continue
      this.runAuto(worker, controller, task)
    }

  }
}

module.exports = { ColonyOrchestrator }
