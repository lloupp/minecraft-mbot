const { Movements } = require('mineflayer-pathfinder')
const food = require('../lib/food')
const gather = require('../lib/gather')
const { resolveBlockNames } = require('./resources')
const { candidateIntents } = require('../lib/player-loop')
const { realStateSnapshot } = require('../lib/real-state')
const worldObserver = require('../lib/world-observer')
const { executePreparationStep, preparationDispatchTask, preparationStateSnapshot } = require('../lib/forced-preparation')
const { sleep, HUNGRY, PATH_TICK_MS, PATH_THINK_MS, PREPARATION_SITE_TTL_MS, COOKABLE, summarizeGatherRecovery, shadowObjectiveKey, protectPenBlocks } = require('./worker/shared')

class WorkerController {
  constructor({ bot, name, role, homeProvider, ownerProvider, storage = null, production = null, logger = console, shadow = null, worldMemory = null, juliaAuthority = null }) {
    this.bot = bot
    this.name = name
    this.role = role
    this.homeProvider = homeProvider
    this.ownerProvider = ownerProvider
    this.storage = storage
    this.production = production
    this.logger = logger
    // Shadow mode da Julia-1 (opcional): só observa em paralelo, nunca decide
    // nada aqui. Ver a chamada em run() e lib/shadow-observer.js.
    this.shadow = shadow
    // Memória espacial compartilhada (conhecimento, nunca executor): o mundo real continua sendo a verdade.
    this.worldMemory = worldMemory
    // Autoridade da Julia (opt-in, MBOT_JULIA_AUTHORITY=1): escolhe entre os candidatos do player loop; a execução
    // continua no executor determinístico. Desligada, a escolha é a determinística de sempre.
    this.juliaAuthority = juliaAuthority
    this._shadowFailureStreak = 0
    this._shadowFailureKey = null
    this._shadowFailureEntry = null
    this._shadowLineageSeq = 0
    this.state = 'conectando'
    this.currentTask = null
    this.taskVersion = 0
    this._preparationResumeCandidate = null
    this.exploreStep = 0
    this.workMoves = null
    this.penMoves = null
    this.activePen = null     // curral com portão aberto ou com o bot dentro
    // Atração de animais: segue só com o animal a até `near` blocos; a mais de
    // `lost` ele desistiu; espera até `waitMs` ele alcançar.
    this.lure = { near: 3, lost: 10, waitMs: 5000, pollMs: 250, timeoutMs: 45000 }
    this.eating = false
    this.defending = false
    this.diggingOut = false
    this.lastHealth = null
    this.lastAttacker = null
    this.survivalTimer = null
    this._baseBed = null           // posição da cama da base (vista ou colocada)
    this._failedHunts = new Map()  // animal -> até quando não oferecer de novo (a caça não o alcançou)
    this._sheltered = false        // dentro do abrigo cavado (o vigia de progresso não conta)
    this._progressAnchor = null
    this._loopIntent = null
    this._ignoredThreats = new Map() // id -> até quando (luta que expirou sem alcançar o monstro)

    bot.once('spawn', () => {
      this.workMoves = new Movements(bot)
      // Navegação não escava atalhos (nem pedra à mão, nem construções).
      // Coleta e obras continuam cavando explicitamente com bot.dig.
      this.workMoves.canDig = false
      // Subir empilhando blocos (terra/pedregulho do próprio inventário) é o único
      // jeito de sair de um poço 1x1 que o worker cavou minerando para baixo.
      this.workMoves.allow1by1towers = true
      protectPenBlocks(this.workMoves, bot.registry)
      // Perto/dentro do curral: sem cavar e sem correr.
      this.penMoves = new Movements(bot)
      this.penMoves.canDig = false
      this.penMoves.allow1by1towers = false
      this.penMoves.allowSprinting = false
      // Sem andaimes: um bloco de terra posto dentro do curral vira degrau e os
      // animais pulavam a cerca (visto no 1.20.1 após !reproduzir).
      this.penMoves.scafoldingBlocks = []
      protectPenBlocks(this.penMoves, bot.registry)
      bot.pathfinder.setMovements(this.workMoves)
      bot.pathfinder.tickTimeout = PATH_TICK_MS
      bot.pathfinder.thinkTimeout = PATH_THINK_MS
      this.state = 'ocioso'
      this.survivalTimer = setInterval(() => this.survivalTick(), 1000)
      this.survivalTimer.unref?.()
    })

    bot.once('end', () => {
      clearInterval(this.survivalTimer)
      this.taskVersion++
      this._toolReservation = null
      this.state = 'desconectado'
      this.currentTask = null
    })

    bot.on('entityHurt', (entity, source) => {
      if (entity === bot.entity && source) this.lastAttacker = source
    })

    // Tomou dano: interrompe a tarefa para lutar ou fugir.
    bot.on('health', () => {
      if (this.lastHealth !== null && bot.health < this.lastHealth && bot.health > 0) {
        if (this.headBlock()) {
          // Sufocando (areia/cascalho caiu na cabeça): cava para sair, não é ataque.
          this.digOut().catch((err) => this.logger.log(`[colônia] ${this.name} soterrado: ${err.message}`))
          this.lastAttacker = null
        } else if (!this.defending) {
          this.defend(this.lastAttacker).catch((err) => this.logger.log(`[colônia] ${this.name} defesa: ${err.message}`))
          this.lastAttacker = null
        }
      }
      this.lastHealth = bot.health
    })

    bot.on('death', () => {
      // Onde caíram os itens (somem em 5 min): base para a opção recover_items depois de renascer.
      if (this.bot.entity?.position) this._deathDrops = { position: this.bot.entity.position.clone(), at: Date.now() }
      this.logger.log(`[colônia] ${this.name} morreu.`)
      this.cancel()
      this.lastHealth = null
    })
  }

  // Defesa com o explorador desarmado e recursos ao alcance: lembra o local para uma volta única depois.
  rememberPreparationSiteWhenUnarmed() {
    if (process.env.MBOT_EXPLORE_PREPARATION !== '1') return
    const site = this._preparationSite
    if (site && Date.now() - site.at <= PREPARATION_SITE_TTL_MS) return
    try {
      const state = preparationStateSnapshot(this.bot, { type: 'explorar' }, {
        homeProvider: this.homeProvider,
        allowedTargets: this.nearbyPreparationAllowlist()
      })
      if (!state.equippedWeapon && (state.nearby?.wood || state.nearby?.stone)) {
        this._preparationSite = { position: this.bot.entity.position.clone(), at: Date.now() }
      }
    } catch { /* melhor esforço: nunca atrasa a defesa */ }
  }

  buildPreparationResumeTask(interruptedTask) {
    if (!interruptedTask?.objective || typeof interruptedTask.objective !== 'object') return null
    const state = preparationStateSnapshot(this.bot, interruptedTask.objective, {
      homeProvider: this.homeProvider,
      allowedTargets: Array.isArray(interruptedTask.allowedTargets) ? interruptedTask.allowedTargets : []
    })
    return preparationDispatchTask({
      enabled: process.env.MBOT_DETERMINISTIC_PREPARATION === '1',
      state,
      objective: interruptedTask.objective,
      allowedTargets: Array.isArray(interruptedTask.allowedTargets) ? interruptedTask.allowedTargets : [],
      timeoutMs: interruptedTask.timeoutMs
    })
  }

  pendingPreparationResume() {
    if (!this._preparationResumeCandidate) return null
    return {
      ...this._preparationResumeCandidate,
      objective: this._preparationResumeCandidate.objective ? { ...this._preparationResumeCandidate.objective } : null,
      allowedTargets: Array.isArray(this._preparationResumeCandidate.allowedTargets)
        ? this._preparationResumeCandidate.allowedTargets.map((target) => ({ ...target }))
        : []
    }
  }

  snapshot() {
    return {
      state: this.state,
      task: this.currentTask ? { ...this.currentTask } : null
    }
  }

  isIdle() {
    return this.state === 'ocioso' && !this._toolReservation && !this._toolDrain
  }

  reserveTool() {
    if (!this.isIdle() || this.currentTask || this.defending || this.eating || this.diggingOut || this._preparationDrain || !this.bot.entity || this.bot.health <= 0) return null
    const token = { version: this.taskVersion }
    this._toolReservation = token
    return token
  }

  ownsTool(token) {
    return this._toolReservation === token && token.version === this.taskVersion && this.state === 'ocioso' && !this.currentTask && !this.defending && !this.eating && !this.diggingOut && Boolean(this.bot.entity) && this.bot.health > 0
  }

  releaseTool(token) {
    if (this._toolReservation === token) this._toolReservation = null
  }

  async waitReady(timeoutMs = 15000) {
    if (this.bot.entity && this.workMoves) return
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('bot ainda não terminou de entrar no mundo'))
      }, timeoutMs)
      const onSpawn = () => {
        cleanup()
        resolve()
      }
      const onEnd = () => {
        cleanup()
        reject(new Error('bot desconectou antes do spawn'))
      }
      const cleanup = () => {
        clearTimeout(timer)
        this.bot.removeListener('spawn', onSpawn)
        this.bot.removeListener('end', onEnd)
      }
      this.bot.once('spawn', onSpawn)
      this.bot.once('end', onEnd)
    })
  }

  cancel() {
    this.taskVersion++
    this._toolReservation = null
    this.currentTask = null
    if (this.bot.targetDigBlock) this.bot.stopDigging()?.catch?.(() => {})
    this.bot.pathfinder?.setGoal(null)
    if (this.state !== 'desconectado') this.state = this.bot.entity ? 'ocioso' : 'conectando'
  }

  async run(task, { canStart = null } = {}) {
    await this.waitReady()
    // HTTP tools reserve an idle worker before checkpoint I/O. An owner command,
    // death, defense or disconnect during readiness must win before any new work.
    if (canStart && !canStart()) return { ok: false, code: 'CANCELLED', cancelled: true }
    const preparationDrain = this._preparationDrain
    this.cancel()
    this._preparationResumeCandidate = null
    const version = this.taskVersion
    const isCancelled = () => version !== this.taskVersion
    this.currentTask = { ...task }
    this.state = 'trabalhando'
    // A submitted craft cannot be rolled back. Invalidate ownership immediately,
    // but let that preparation settle before the new owner starts physical work.
    if (preparationDrain) await preparationDrain.catch(() => {})
    if (isCancelled()) return { ok: false, code: 'CANCELLED', cancelled: true }

    // A tarefa em si continua exatamente como antes, só que agora dentro de
    // uma função para termos uma promise (`taskPromise`) que podemos passar
    // ao shadow mode SEM esperar por ela — quem chama `run()` recebe a mesma
    // promise de sempre, no mesmo instante de sempre.
    const taskPromise = (async () => {
      try {
        this.useMoves(this.workMoves)
      await this.leaveLeftoverPen(isCancelled)
      if (isCancelled()) return { ok: false, code: 'CANCELLED', cancelled: true }
      if (this.bot.food <= HUNGRY) await this.eat()
      let result
      switch (task.type) {
        case 'coletar_blocos':
          result = await this.gatherBlocks(task.resource, task.count || 1, isCancelled)
          break
        case 'fazenda':
          result = await this.farm(task.count || 1, isCancelled)
          break
        case 'reproduzir_animais':
          result = await this.breedAnimals(task.species, task.pairs || 1, isCancelled)
          break
        case 'tosquiar':
          result = await this.shearSheep(task.count || 1, isCancelled)
          break
        case 'produto_animal':
          result = await this.collectAnimalProduct(task.product, task.count || 1, isCancelled)
          break
        case 'manejar_populacao':
          result = await this.manageAnimalPopulation(task.species, task.target || 6, isCancelled)
          break
        case 'construir_curral':
          result = await this.buildAnimalPen(isCancelled, task.species || 'cow', task.offset || null)
          break
        case 'capturar_animais':
          result = await this.captureAnimals(task.species, task.count || 1, isCancelled)
          break
        case 'explorar':
          result = await this.runExplorePlayerLoop(task, isCancelled)
          break
        case 'ir_local':
          result = await this.goToPoint(task.position, isCancelled)
          break
        case 'guardar':
          result = await this.guard(task.durationMs || 20000, isCancelled)
          break
        case 'construir_casa':
          result = await this.buildHouse(isCancelled, task.offset)
          break
        case 'construir_fazenda':
          result = await this.buildFarm(isCancelled, task.offset)
          break
        case 'construir_mina':
          result = await this.buildMine(isCancelled, task.length || 12)
          break
        case 'construir_planta':
          result = await this.buildBlueprintRegion(isCancelled, task)
          break
        case 'retirar_estoque':
          result = await this.withdrawFromStorage(task.item, task.count || 1)
          break
        case 'fabricar':
          result = await this.craft(task.item, task.count || 1)
          break
        case 'depositar':
          result = await this.depositCargo()
          break
        case 'sincronizar_estoque':
          result = await this.syncStorage()
          break
        case 'voltar':
          result = await this.returnHome(isCancelled)
          break
        case 'preparar_combate_deterministico':
          result = await this.runDeterministicPreparation(task, isCancelled)
          break
        default:
          throw new Error(`tarefa desconhecida: ${task.type}`)
      }
        return result
      } finally {
        if (!isCancelled() && this.state !== 'desconectado') {
          this.currentTask = null
          this.state = 'ocioso'
          this.bot.pathfinder?.setGoal(null)
        }
      }
    })()

    if (task.type === 'preparar_combate_deterministico') {
      this._preparationDrain = taskPromise
      const clearDrain = () => { if (this._preparationDrain === taskPromise) this._preparationDrain = null }
      taskPromise.then(clearDrain, clearDrain)
    }
    this._observeShadow(task.type === 'preparar_combate_deterministico' ? (task.objective || task) : task, isCancelled, taskPromise)
    return taskPromise
  }

  async runDeterministicPreparation(task, isCancelled) {
    const objective = task?.objective
    if (!objective || typeof objective !== 'object' || !objective.type) {
      return { ok: false, code: 'OBJECTIVE_REQUIRED', juliaExecutionAuthority: 'none' }
    }

    const ownerVersion = this.taskVersion
    return executePreparationStep({
      enabled: process.env.MBOT_DETERMINISTIC_PREPARATION === '1',
      bot: this.bot,
      task: objective,
      production: this.production,
      allowedTargets: Array.isArray(task.allowedTargets) ? task.allowedTargets : [],
      homeProvider: this.homeProvider,
      isCancelled,
      timeoutMs: Number(task.timeoutMs) > 0 ? Number(task.timeoutMs) : 20000,
      authorizedIntent: task.authorizedIntent || null,
      onEvent: event => this.logger.log?.(`[deterministic-preparation] ${JSON.stringify({ worker: this.name, taskVersion: ownerVersion, currentVersion: this.taskVersion, ...event })}`)
    })
  }

  // Shadow mode: só observa, nunca decide. Nunca lança e nunca é
  // `await`ado por run() — ver lib/shadow-observer.js para as garantias.
  _observeShadow(task, isCancelled, taskPromise) {
    try { if (!this.shadow?.enabled?.()) return } catch { return }
    // Retomada: a tarefa anterior foi interrompida (ainda rodava quando esta
    // chegou, ou foi cancelada antes de terminar, ex.: por um reflexo) e o
    // objetivo é o mesmo (mesma chave de objetivo: tipo, recurso, alvo...). Só leitura, para o registro.
    // Qualquer falha aqui nunca pode virar rejeição de run(): fail-open.
    let resumed = false
    let taskLineageId = null
    let failureKey = null
    let entry = null
    try {
      const prev = this._shadowPrev
      failureKey = shadowObjectiveKey(task)
      resumed = Boolean(prev && (!prev.settled || prev.interrupted) && prev.failureKey === failureKey)
      taskLineageId = resumed && prev?.taskLineageId
        ? prev.taskLineageId
        : `${this.name}:${++this._shadowLineageSeq}`
      if (this._shadowFailureKey !== failureKey) {
        this._shadowFailureKey = failureKey
        this._shadowFailureStreak = 0
      }
      entry = { task, settled: false, interrupted: false, taskLineageId, failureKey }
      this._shadowPrev = entry
      this._shadowFailureEntry = entry
    } catch (error) {
      this.logger.log?.(`[shadow] ${this.name}: falha ao registrar linhagem: ${error.message}`)
      return
    }
    try {
      const state = realStateSnapshot(this.bot, task, {
        homeProvider: this.homeProvider,
        consecutiveFailures: this._shadowFailureStreak
      })
      const candidates = candidateIntents(state)
      if (candidates.length > 1) {
        this.shadow.observe({
          state,
          objective: task,
          candidates,
          executedChoice: task.type,
          resultPromise: taskPromise,
          nextStateProvider: () => realStateSnapshot(this.bot, task, { homeProvider: this.homeProvider }),
          meta: { worker: this.name, interruptedCheck: isCancelled, resumed, taskLineageId }
        })
      }
    } catch (error) {
      this.logger.log?.(`[shadow] ${this.name}: falha ao preparar observação: ${error.message}`)
    }

    taskPromise.then(
      (value) => {
        entry.settled = true
        entry.interrupted = isCancelled()
        if (this._shadowFailureEntry !== entry || this._shadowFailureKey !== entry.failureKey) return

        const cancelled = entry.interrupted || value?.cancelled === true || value?.code === 'CANCELLED'
        if (cancelled) return

        const failed = value && value.ok === false
        this._shadowFailureStreak = failed ? this._shadowFailureStreak + 1 : 0
      },
      () => {
        entry.settled = true
        entry.interrupted = isCancelled()
        if (this._shadowFailureEntry !== entry || this._shadowFailureKey !== entry.failureKey) return
        if (entry.interrupted) return
        this._shadowFailureStreak++
      }
    )
  }

  // Mesma coleta do food: espera o item aparecer (até 1,5 s) e passa mais de uma vez.
  async collectDrops(center, isCancelled) {
    await food.collectDrops(this.bot, center, isCancelled)
  }

  async gatherBlocks(resource, count, isCancelled) {
    await this.ensureRoleTool()
    const names = resolveBlockNames(this.bot, resource, this.role)
    if (!names.length) throw new Error(`não conheço o recurso "${resource}"`)
    const wanted = new Set(names.filter((name) => Number.isInteger(this.bot.registry.blocksByName[name]?.id)))
    if (!wanted.size) throw new Error(`nenhum bloco compatível com "${resource}"`)

    // gather pula blocos inalcançáveis em vez de insistir sempre no mesmo.
    const evidence = []
    const kind = [...wanted].map(worldObserver.resourceKindForBlock).find(Boolean) || null
    const dim = worldObserver.dimensionOf(this.bot)
    const isWood = [...wanted].every((name) => name.endsWith('_log') || name === 'crimson_stem' || name === 'warped_stem')
    const mine = (n) => gather.mineBlocks(this.bot, (name) => wanted.has(name), n, isCancelled, {
      // Wood drops may land under foliage/outside the 1.425-block pickup window.
      // These are guarded moves, not synthetic inventory credits.
      retryPickup: isWood,
      clearLeaves: isWood,
      onAttempt: (attempt) => {
        evidence.push(attempt); if (evidence.length > 20) evidence.shift()
        // Fonte confirmada no mundo (item no inventário) => registra a região do recurso.
        if (attempt.itemConfirmed && kind && attempt.targetPosition && this.worldMemory) {
          this.worldMemory.discover(kind, dim, attempt.targetPosition, { by: this.name })
        }
      }
    })
    if (this.worldMemory) this.observeWorld()
    let gathered = await mine(count)
    // Nada à vista: a memória só sugere ONDE olhar; depois é o mesmo findBlocks/dig/confirmação de sempre.
    if (gathered < count && !isCancelled() && kind && this.memoryGuideOn() &&
        evidence.findLast((attempt) => attempt.code)?.code === gather.COLLECTION_FAILURE.RESOURCE_NOT_FOUND) {
      if (await this.rememberedResourceDetour(kind, isCancelled)) gathered += await mine(count - gathered)
    }
    if (this.worldMemory && !isCancelled()) this.observeWorld() // recurso esgotado => região invalidada

    const deposited = !isCancelled() && this.storage?.configured()
      ? await this.storage.depositCargo(this.bot).catch((err) => { this.logger.log(`[estoque] ${this.name} não depositou: ${err.message}`); return {} })
      : {}
    const ok = !isCancelled() && gathered >= count
    const code = isCancelled() ? gather.COLLECTION_FAILURE.CANCELLED
      : ok ? undefined : evidence.findLast((attempt) => attempt.code)?.code || gather.COLLECTION_FAILURE.RESOURCE_NOT_FOUND
    const recovery = summarizeGatherRecovery(evidence)
    return { ok, verified: ok, code, gathered, requested: count, resource, exhausted: gathered < count, deposited, recovery, evidence }
  }

  inventoryCountByName(name) {
    return this.bot.inventory.items()
      .filter((item) => item.name === name)
      .reduce((sum, item) => sum + (item.count || 0), 0)
  }

  async ensureItemAmount(name, count) {
    const wanted = Math.max(1, Number.parseInt(count, 10) || 1)
    let have = this.inventoryCountByName(name)
    if (have >= wanted) return have

    if (this.storage?.configured()) {
      await this.storage.withdraw(this.bot, name, wanted - have).catch(() => 0)
      have = this.inventoryCountByName(name)
      if (have >= wanted) return have
    }

    if (this.production) {
      try {
        await this.production.craftInternal(this.bot, name, wanted - have)
      } catch (err) {
        this.logger.log?.(`[colônia] ${this.name} não fabricou ${name}: ${err.message}`)
      }
      have = this.inventoryCountByName(name)
    }

    return have
  }

  // Dá para cozinhar agora: ≥2 carnes cruas, combustível na mochila e fornalha a ≤24 (ou 8 pedregulhos para fazer uma).
  canCook() {
    try {
      const items = this.bot.inventory?.items?.() || []
      const raw = items.filter((i) => COOKABLE.has(i.name)).reduce((n, i) => n + i.count, 0)
      if (raw < 2) return false
      const fuel = items.some((i) => i.name === 'coal' || i.name === 'charcoal' || i.name.endsWith('_planks') || i.name.endsWith('_log'))
      if (!fuel) return false
      const cobble = items.filter((i) => i.name === 'cobblestone').reduce((n, i) => n + i.count, 0)
      const furnaceId = this.bot.registry?.blocksByName?.furnace?.id
      return cobble >= 8 || Boolean(furnaceId != null && this.bot.findBlock?.({ matching: furnaceId, maxDistance: 24 }))
    } catch { return false }
  }

  async resyncInventory() {
    if (this.bot.currentWindow) { try { this.bot.closeWindow(this.bot.currentWindow) } catch { /* nada a fechar */ } }
    if (typeof this.bot._syncWindow !== 'function') return
    await Promise.race([this.bot._syncWindow(this.bot.inventory).catch(() => {}), sleep(2000)])
  }

  async ensureRoleTool() {
    const kind = this.role === 'minerador'
      ? 'pickaxe'
      : this.role === 'lenhador'
        ? 'axe'
        : this.role === 'guarda'
          ? 'sword'
          : null
    if (!kind) return null

    const hasTool = this.bot.inventory.items().some((item) => item.name.endsWith(`_${kind}`))
    if (hasTool) return null

    if (this.storage?.configured()) {
      const withdrawn = await this.storage.withdrawBestTool(this.bot, kind)
      if (withdrawn) return withdrawn
    }

    if (this.production) {
      const candidates = kind === 'sword'
        ? ['iron_sword', 'stone_sword', 'wooden_sword']
        : kind === 'pickaxe'
          ? ['iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe']
          : ['iron_axe', 'stone_axe', 'wooden_axe']

      for (const item of candidates) {
        try {
          const made = await this.production.craftInternal(this.bot, item, 1)
          if (made) return { name: item, count: 1, crafted: true }
        } catch { /* sem material para esta opção; tenta a próxima */ }
      }
    }

    return null
  }

  async withdrawFromStorage(item, count) {
    if (!this.storage?.configured()) throw new Error('estoque central não configurado')
    const withdrawn = await this.storage.withdraw(this.bot, item, count)
    return { ok: withdrawn > 0, item, withdrawn, requested: count }
  }

  async depositCargo() {
    if (!this.storage?.configured()) throw new Error('estoque central não configurado')
    const deposited = await this.storage.depositCargo(this.bot)
    return { ok: true, deposited }
  }

  async syncStorage() {
    if (!this.storage?.configured()) throw new Error('estoque central não configurado')
    const stock = await this.storage.summary(this.bot)
    return { ok: true, stock }
  }

  async craft(item, count) {
    if (!this.production) throw new Error('produção não configurada')
    return this.production.craftToStorage(this.bot, item, count)
  }
}

// Comportamentos em core/worker/: os métodos entram no prototype como se fossem desta classe.
const { SurvivalBehavior } = require('./worker/survival')
const { PensBehavior } = require('./worker/pens')
const { PlayerLoopBehavior } = require('./worker/player-loop')
const { ExplorationBehavior } = require('./worker/exploration')
const { NavigationBehavior } = require('./worker/navigation')
const { ConstructionBehavior } = require('./worker/construction')
for (const Behavior of [SurvivalBehavior, PensBehavior, PlayerLoopBehavior, ExplorationBehavior, NavigationBehavior, ConstructionBehavior]) {
  for (const key of Object.getOwnPropertyNames(Behavior.prototype)) {
    if (key === 'constructor') continue
    Object.defineProperty(WorkerController.prototype, key, Object.getOwnPropertyDescriptor(Behavior.prototype, key))
  }
}

module.exports = { WorkerController, protectPenBlocks, shadowObjectiveKey, summarizeGatherRecovery }
