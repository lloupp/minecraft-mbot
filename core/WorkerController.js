const { Movements, goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const food = require('../lib/food')
const gather = require('../lib/gather')
const combat = require('../lib/combat')
const husbandry = require('../lib/husbandry')
const animalProducts = require('../lib/animalProducts')
const stateMachineExplore = require('../lib/stateMachineExplore')
const { groundedPenPlan, pointInsidePen, inspectAnimalPen, SPECIES_OFFSETS } = require('./AnimalPen')
const { resolveBlockNames } = require('./resources')
const blueprint = require('../lib/blueprint')
const { buildBlueprint } = require('../lib/blueprintBuilder')
const { candidateIntents, deterministicPlayerPolicy } = require('../lib/player-loop')
const { realStateSnapshot } = require('../lib/real-state')
const { preparationRadius, executePreparationStep, preparationDispatchTask, preparationIntegrationPreflight, preparationIntegrationTask, preparationStateSnapshot } = require('../lib/forced-preparation')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const HUNGRY = 14         // abaixo disso come o que tiver
const FLEE_DISTANCE = 16  // distância que tenta manter da ameaça
const FLEE_MS = 4000      // tempo fugindo
const CREEPER_RANGE = 5   // creeper mais perto que isso: foge
// Blocos naturais que podem ser cavados para abrir a linha do curral.
const NATURAL_TERRAIN = /^(grass_block|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|mud|clay|sand|red_sand|gravel|stone|andesite|diorite|granite|tuff|snow_block)$/
// Todos os workers dividem o mesmo processo Node. Com o padrão do pathfinder
// (40 ms de A* por tick), 7 workers calculando caminhos longos ao mesmo tempo
// saturavam a CPU e o servidor os derrubava por "Timed out".
const PATH_TICK_MS = 8
// O thinkTimeout conta tempo de relógio, não de cálculo: com 8 ms por tick o
// padrão de 5 s dá ~0,8 s de A* e caminhos longos falhavam com "Took to long".
// 25 s mantém o mesmo cálculo que 5 s com o tickTimeout padrão de 40 ms.
const PATH_THINK_MS = 25000
// Tempo para uma viagem longa: ~700 ms por bloco (medido ~2 blocos/s com vários
// workers calculando caminho ao mesmo tempo), nunca menos de 30 s.
const MS_PER_BLOCK = 700
const POINT_ARRIVAL_RADIUS = 2
const PREPARATION_SITE_TTL_MS = 90000
const PREPARATION_SITE_MAX_DISTANCE = 16
const PREPARATION_STAGING_MAX_DISTANCE = 8
const PREPARATION_STAGING_SAFETY_POLL_MS = 100
const EXPLORE_FAR_MARGIN = 32
const PHYSICAL_PREPARATION_REFUSALS = new Set(['TARGET_BLOCKED', 'APPROVED_TARGETS_INSUFFICIENT', 'MINING_PICKAXE_REQUIRED', 'COBBLESTONE_DROP_REQUIRED', 'NEARBY_TABLE_REQUIRED'])
const NAVIGATION_POSITION_NOT_CONFIRMED = 'NAVIGATION_POSITION_NOT_CONFIRMED'
function travelTimeoutMs(from, to) {
  if (!from || !to) return 30000
  const d = Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z)
  return Math.max(30000, Math.round(d * MS_PER_BLOCK))
}

function summarizeGatherRecovery(evidence = []) {
  const failedWithAlternate = evidence.findIndex((attempt) =>
    attempt?.code &&
    attempt.code !== gather.COLLECTION_FAILURE.CANCELLED &&
    attempt.alternateTargetCandidateObserved === true
  )
  if (failedWithAlternate < 0) {
    return { alternateTargetObserved: false, alternateTargetRecoveryConfirmed: false }
  }
  return {
    alternateTargetObserved: true,
    alternateTargetRecoveryConfirmed: evidence
      .slice(failedWithAlternate + 1)
      .some((attempt) => attempt?.itemConfirmed === true)
  }
}

function shadowObjectiveKey(task) {
  if (!task) return 'none'
  const point = (value) => value && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y)) && Number.isFinite(Number(value.z))
    ? [Math.floor(Number(value.x)), Math.floor(Number(value.y)), Math.floor(Number(value.z))]
    : null
  return JSON.stringify({
    type: task.type || null,
    resource: task.resource || null,
    item: task.item || null,
    product: task.product || null,
    species: task.species || null,
    planta: task.planta || null,
    region: task.region || null,
    position: point(task.position),
    center: point(task.center),
    origin: point(task.origin)
  })
}

// Cercas e portões nunca podem ser quebrados pelo pathfinder: um buraco no
// curral solta os animais (e com canOpenDoors=false ele prefere cavar a cerca).
function protectPenBlocks(moves, registry) {
  for (const block of registry?.blocksArray || []) {
    if (block.name.endsWith('_fence') || block.name.endsWith('_fence_gate')) {
      moves.blocksCantBreak.add(block.id)
    }
  }
  return moves
}

class WorkerController {
  constructor({ bot, name, role, homeProvider, ownerProvider, storage = null, production = null, logger = console, shadow = null }) {
    this.bot = bot
    this.name = name
    this.role = role
    this.homeProvider = homeProvider
    this.ownerProvider = ownerProvider
    this.storage = storage
    this.production = production
    this.logger = logger
    // Shadow mode do Laya (opcional): só observa em paralelo, nunca decide
    // nada aqui. Ver a chamada em run() e lib/laya-shadow.js.
    this.shadow = shadow
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
      this.logger.log(`[colônia] ${this.name} morreu.`)
      this.cancel()
      this.lastHealth = null
    })
  }

  // Sobrevivência entre e durante tarefas: come quando tem fome e foge de creepers.
  survivalTick() {
    if (!this.bot.entity || this.defending) return
    const creeper = this.bot.nearestEntity((e) => combat.EXPLOSIVE.has(e.name) &&
      e.position.distanceTo(this.bot.entity.position) <= CREEPER_RANGE)
    if (creeper) {
      this.defend(creeper).catch(() => {})
      return
    }
    if (this.bot.food <= HUNGRY && !this.bot.targetDigBlock) this.eat()
  }

  // Bloco sólido e cavável na altura dos olhos: o bot está sufocando.
  headBlock() {
    const position = this.bot.entity?.position
    if (!position) return null
    const block = this.bot.blockAt(position.offset(0, 1.62, 0))
    return block && block.boundingBox === 'block' && block.diggable !== false ? block : null
  }

  async digOut() {
    if (this.diggingOut) return
    this.diggingOut = true
    try {
      // Areia/cascalho continuam caindo: repete algumas vezes, cabeça e depois pés.
      for (let i = 0; i < 6; i++) {
        const head = this.headBlock()
        // Nos pés só cava o que caiu (areia/cascalho), não o chão (terra arada, areia das almas).
        const feet = this.bot.blockAt(this.bot.entity.position)
        const block = head || (gather.FALLING.has(feet?.name) ? feet : null)
        if (!block) break
        const tool = this.bot.pathfinder?.bestHarvestTool?.(block)
        if (tool) await this.bot.equip(tool, 'hand').catch(() => {})
        await this.bot.dig(block)
        await sleep(150)
      }
    } finally {
      this.diggingOut = false
    }
  }

  async eat() {
    if (this.eating || !food.hasFood(this.bot)) return null
    this.eating = true
    try {
      return await food.eat(this.bot)
    } catch {
      return null
    } finally {
      this.eating = false
    }
  }

  // Luta ou foge (conforme combat.decide). Cancela a tarefa atual; o modo
  // automático vê o worker ocupado ('defendendo') e só redistribui depois.
  async defend(attacker) {
    const bot = this.bot
    const living = attacker && attacker !== bot.entity && attacker.isValid !== false
    const threat = living
      ? attacker
      : bot.nearestEntity((e) => e.type === 'hostile' && e.position.distanceTo(bot.entity.position) <= FLEE_DISTANCE)
    if (!threat) return null

    const interruptedPreparation = this.currentTask?.type === 'preparar_combate_deterministico'
      ? {
          ...this.currentTask,
          objective: this.currentTask.objective ? { ...this.currentTask.objective } : null,
          allowedTargets: Array.isArray(this.currentTask.allowedTargets)
            ? this.currentTask.allowedTargets.map((target) => ({ ...target }))
            : []
        }
      : null
    const preparationDrain = this._preparationDrain
    this.rememberPreparationSiteWhenUnarmed()
    this.cancel()
    this.defending = true
    this.state = 'defendendo'
    const version = this.taskVersion
    const isCancelled = () => version !== this.taskVersion
    let result = 'fugi'
    try {
      if (preparationDrain) await preparationDrain.catch(() => {})
      if (isCancelled()) return 'cancelado'
      if (combat.decide(bot, threat) === 'lutar') {
        result = await combat.fight(bot, threat, isCancelled)
        if (result === 'recuei') await this.flee(threat, isCancelled)
      } else {
        await this.flee(threat, isCancelled)
      }
      this.logger.log(`[colônia] ${this.name} ${threat.name}: ${result}`)
      return result
    } finally {
      this.defending = false
      if (!isCancelled()) {
        this.state = 'ocioso'
        bot.pathfinder?.setGoal(null)
        this._preparationResumeCandidate = interruptedPreparation
          ? this.buildPreparationResumeTask(interruptedPreparation)
          : null
      }
    }
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

  async flee(threat, isCancelled) {
    this.bot.pathfinder.setGoal(new goals.GoalInvert(new goals.GoalFollow(threat, FLEE_DISTANCE)), true)
    const until = Date.now() + FLEE_MS
    while (Date.now() < until && !isCancelled()) await sleep(200)
  }

  snapshot() {
    return {
      state: this.state,
      task: this.currentTask ? { ...this.currentTask } : null
    }
  }

  isIdle() {
    return this.state === 'ocioso'
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
    this.currentTask = null
    if (this.bot.targetDigBlock) this.bot.stopDigging()?.catch?.(() => {})
    this.bot.pathfinder?.setGoal(null)
    if (this.state !== 'desconectado') this.state = this.bot.entity ? 'ocioso' : 'conectando'
  }

  async run(task) {
    await this.waitReady()
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
      onEvent: event => this.logger.log?.(`[deterministic-preparation] ${JSON.stringify({ worker: this.name, taskVersion: ownerVersion, currentVersion: this.taskVersion, ...event })}`)
    })
  }

  // Shadow mode do Laya: só observa, nunca decide. Nunca lança e nunca é
  // `await`ado por run() — ver lib/laya-shadow.js para as garantias.
  _observeShadow(task, isCancelled, taskPromise) {
    if (!this.shadow?.enabled?.()) return
    // Retomada: a tarefa anterior foi interrompida (ainda rodava quando esta
    // chegou, ou foi cancelada antes de terminar, ex.: por um reflexo) e o
    // objetivo é o mesmo. Só leitura, para o registro.
    const prev = this._shadowPrev
    const resumed = Boolean(prev && (!prev.settled || prev.interrupted) && prev.task.type === task.type &&
      (prev.task.resource ?? null) === (task.resource ?? null))
    const taskLineageId = resumed && prev?.taskLineageId
      ? prev.taskLineageId
      : `${this.name}:${++this._shadowLineageSeq}`
    const failureKey = shadowObjectiveKey(task)
    if (this._shadowFailureKey !== failureKey) {
      this._shadowFailureKey = failureKey
      this._shadowFailureStreak = 0
    }
    const entry = { task, settled: false, interrupted: false, taskLineageId, failureKey }
    this._shadowPrev = entry
    this._shadowFailureEntry = entry
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
      this.logger.log?.(`[laya-shadow] ${this.name}: falha ao preparar observação: ${error.message}`)
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

  useMoves(moves) {
    if (moves && typeof this.bot.pathfinder?.setMovements === 'function') this.bot.pathfinder.setMovements(moves)
  }

  // Curral construído (com portão) que contém a posição, entre os das espécies conhecidas.
  penAt(position) {
    const home = this.homeProvider?.()
    if (!home || !position) return null
    for (const species of Object.keys(SPECIES_OFFSETS)) {
      const plan = groundedPenPlan(this.bot, home, species)
      if (pointInsidePen(position, plan) && inspectAnimalPen(this.bot, plan).gatePresent) return plan
    }
    return null
  }

  // Uma tarefa cancelada no meio do manejo pode deixar o bot dentro do curral
  // ou o portão aberto: sai pelo portão (abrir → sair → fechar) antes de seguir,
  // senão o pathfinder tentaria atravessar a cerca.
  async leaveLeftoverPen(isCancelled) {
    const plan = this.activePen || this.penAt(this.bot.entity?.position)
    if (!plan) return
    this.useMoves(this.penMoves)
    try {
      if (this.bot.entity && pointInsidePen(this.bot.entity.position, plan)) {
        await this.leaveAnimalPen(plan, isCancelled)
      } else {
        await this.setPenGate(plan, false, isCancelled)
      }
    } catch (err) {
      this.logger.log(`[colônia] ${this.name} não saiu do curral: ${err.message}`)
    } finally {
      if (!isCancelled()) {
        this.activePen = null
        this.useMoves(this.workMoves)
      }
    }
  }

  async goTo(goal, timeoutMs = 20000) {
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        this.bot.pathfinder.setGoal(null)
        reject(new Error('caminho demorou demais'))
      }, timeoutMs)
    })
    try {
      await Promise.race([this.bot.pathfinder.goto(goal), timeout])
    } finally {
      clearTimeout(timer)
    }
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
    const gathered = await gather.mineBlocks(this.bot, (name) => wanted.has(name), count, isCancelled, {
      onAttempt: (attempt) => { evidence.push(attempt); if (evidence.length > 20) evidence.shift() }
    })

    const deposited = !isCancelled() && this.storage?.configured()
      ? await this.storage.depositCargo(this.bot).catch((err) => { this.logger.log(`[estoque] ${this.name} não depositou: ${err.message}`); return {} })
      : {}
    const ok = !isCancelled() && gathered >= count
    const code = isCancelled() ? gather.COLLECTION_FAILURE.CANCELLED
      : ok ? undefined : evidence.findLast((attempt) => attempt.code)?.code || gather.COLLECTION_FAILURE.RESOURCE_NOT_FOUND
    const recovery = summarizeGatherRecovery(evidence)
    return { ok, verified: ok, code, gathered, requested: count, resource, exhausted: gathered < count, deposited, recovery, evidence }
  }

  // Currais construídos (com portão) em volta da base.
  builtPens() {
    const home = this.homeProvider?.()
    if (!home) return []
    return Object.keys(SPECIES_OFFSETS)
      .map((species) => groundedPenPlan(this.bot, home, species))
      .filter((plan) => inspectAnimalPen(this.bot, plan).gatePresent)
  }

  async farm(count, isCancelled) {
    // Os animais do curral são o rebanho: caçar comida não pode abatê-los
    // (visto no 1.20.1: !colonia auto esvaziou o curral de vacas com meta 6).
    const pens = this.builtPens()
    const spare = (entity) => pens.some((plan) => pointInsidePen(entity.position, plan))
    let gathered = 0
    while (gathered < count && !isCancelled()) {
      const result = await food.gatherFood(this.bot, isCancelled, { spare })
      if (!result) break
      gathered++
    }
    const deposited = this.storage?.configured()
      ? await this.storage.depositCargo(this.bot).catch((err) => { this.logger.log(`[estoque] ${this.name} não depositou: ${err.message}`); return {} })
      : {}
    return { ok: gathered > 0, gathered, requested: count, resource: 'comida', exhausted: gathered < count, deposited }
  }

  penContext(species) {
    const canonical = husbandry.normalizeSpecies(species) || species
    const home = this.homeProvider?.()
    if (!home) return null
    const plan = groundedPenPlan(this.bot, home, canonical)
    const status = inspectAnimalPen(this.bot, plan)
    return { canonical, plan, status }
  }

  // Limita a seleção de animais aos que estão dentro do curral.
  penScope(pen) {
    return {
      center: new Vec3(pen.plan.center.x, pen.plan.center.y, pen.plan.center.z),
      range: pen.plan.size + 2,
      filter: (entity) => pointInsidePen(entity.position, pen.plan)
    }
  }

  // Busca a ração ANTES de entrar no curral: lá dentro, ir ao baú faria o
  // pathfinder abrir caminho pela cerca (o portão fica fechado atrás do bot).
  async penFeed(canonical, count) {
    const config = husbandry.SPECIES[canonical]
    if (!config || count < 2) return null
    return husbandry.ensureFeed(this.bot, config, count, this.storage)
  }

  penPopulation(species) {
    const pen = this.penContext(species)
    if (!pen) return { species, built: false, inside: 0, status: null }
    const inside = husbandry.selectAnimals(this.bot, pen.canonical, this.penScope(pen)).length
    return {
      species: pen.canonical,
      built: pen.status.built,
      inside,
      status: pen.status
    }
  }

  async breedAnimals(species, pairs, isCancelled) {
    const pen = this.penContext(species)
    if (!pen?.status?.built) {
      return husbandry.breed(this.bot, species, pairs, isCancelled, {
        storage: this.storage
      })
    }

    const scope = this.penScope(pen)
    const wanted = Math.max(1, Math.min(16, Number.parseInt(pairs, 10) || 1))
    const breedable = husbandry.selectAnimals(this.bot, pen.canonical, scope)
      .filter((entity) => husbandry.canBreed(this.bot, entity))
    const feed = await this.penFeed(pen.canonical, Math.min(wanted * 2, breedable.length - (breedable.length % 2)))
    // Sem par ou sem ração: breed (sem estoque) só informa o motivo, sem sair do lugar.
    if (!feed) return husbandry.breed(this.bot, species, pairs, isCancelled, scope)

    return this.withAnimalPen(pen, isCancelled, () =>
      husbandry.breed(this.bot, species, pairs, isCancelled, scope))
  }

  async shearSheep(count, isCancelled) {
    return husbandry.shearSheep(this.bot, count, isCancelled, {
      storage: this.storage,
      production: this.production
    })
  }

  async collectAnimalProduct(product, count, isCancelled) {
    const normalized = animalProducts.normalizeProduct(product)
    if (!normalized) throw new Error(`produto animal desconhecido: ${product}`)

    if (normalized === 'wool') {
      const pen = this.penContext('sheep')
      if (!pen?.status?.built) return { ok: false, product: normalized, reason: 'curral_incompleto' }
      const shears = await husbandry.ensureShears(this.bot, { storage: this.storage, production: this.production })
      if (!shears) return { ok: false, product: normalized, reason: 'sem_tesoura' }
      const result = await this.withAnimalPen(pen, isCancelled, () =>
        husbandry.shearSheep(this.bot, count, isCancelled, this.penScope(pen))
      )
      const deposited = this.storage?.configured()
        ? await this.storage.depositCargo(this.bot).catch(() => ({}))
        : {}
      return { ...result, product: normalized, deposited }
    }

    if (normalized === 'milk') {
      const pen = this.penContext('cow')
      if (!pen?.status?.built) return { ok: false, product: normalized, reason: 'curral_incompleto' }
      const available = await animalProducts.ensureBuckets(this.bot, count, { storage: this.storage, production: this.production })
      if (available <= 0) return { ok: false, product: normalized, reason: 'sem_baldes' }
      const result = await this.withAnimalPen(pen, isCancelled, () =>
        animalProducts.milkCows(this.bot, count, isCancelled, this.penScope(pen))
      )
      const deposited = this.storage?.configured()
        ? await this.storage.depositCargo(this.bot).catch(() => ({}))
        : {}
      return { ...result, product: normalized, deposited }
    }

    if (normalized === 'eggs') {
      const pen = this.penContext('chicken')
      if (!pen?.status?.built) return { ok: false, product: normalized, reason: 'curral_incompleto' }
      const center = new Vec3(pen.plan.center.x, pen.plan.center.y, pen.plan.center.z)
      const result = await this.withAnimalPen(pen, isCancelled, () =>
        animalProducts.collectEggs(this.bot, center, isCancelled)
      )
      const deposited = this.storage?.configured()
        ? await this.storage.depositCargo(this.bot).catch(() => ({}))
        : {}
      return { ...result, product: normalized, deposited }
    }

    throw new Error(`produto animal sem executor: ${normalized}`)
  }

  async manageAnimalPopulation(species, target, isCancelled) {
    const pen = this.penContext(species)
    if (!pen?.status?.built) {
      const result = await husbandry.managePopulation(this.bot, species, target, isCancelled, {
        storage: this.storage
      })
      return { ...result, penScoped: false }
    }

    const scope = this.penScope(pen)
    const animals = husbandry.selectAnimals(this.bot, pen.canonical, scope)
    const breedable = animals.filter((entity) => husbandry.canBreed(this.bot, entity))
    const plan = husbandry.populationPlan(animals.length, target, breedable.length)
    const feed = plan.pairs > 0 ? await this.penFeed(pen.canonical, plan.pairs * 2) : null
    if (!feed) {
      // Meta atingida, poucos adultos ou sem ração: responde sem entrar no curral.
      const result = await husbandry.managePopulation(this.bot, species, target, isCancelled, scope)
      return { ...result, penScoped: true }
    }

    const result = await this.withAnimalPen(pen, isCancelled, () =>
      husbandry.managePopulation(this.bot, species, target, isCancelled, scope))
    return { ...result, penScoped: true }
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
      } catch {}
      have = this.inventoryCountByName(name)
    }

    return have
  }

  async ensurePenKit(plan) {
    const woods = [
      'oak', 'spruce', 'birch', 'jungle', 'acacia',
      'dark_oak', 'mangrove', 'cherry', 'bamboo'
    ]

    for (const wood of woods) {
      const fence = `${wood}_fence`
      const gate = `${wood}_fence_gate`
      if (!this.bot.registry?.itemsByName?.[fence] || !this.bot.registry?.itemsByName?.[gate]) continue

      const haveFence = await this.ensureItemAmount(fence, plan.fenceCount)
      const haveGate = await this.ensureItemAmount(gate, plan.gateCount)
      if (haveFence >= plan.fenceCount && haveGate >= plan.gateCount) {
        return { fence, gate }
      }
    }
    return null
  }

  async placeGroundItem(position, itemName, isCancelled) {
    if (isCancelled()) return false
    const pos = new Vec3(position.x, position.y, position.z)
    let current = this.bot.blockAt(pos)
    if (current?.name === itemName) return true

    // Terreno 1 bloco acima do chão do curral (grama, terra...) ocupa a linha da
    // cerca: cava para a cerca ficar no nível das outras (visto no 1.20.1: 18/23).
    if (current && NATURAL_TERRAIN.test(current.name)) {
      await this.goTo(new goals.GoalNear(pos.x, pos.y, pos.z, 3), 10000).catch(() => {})
      if (isCancelled()) return false
      await this.bot.dig(current).catch(() => {})
      current = this.bot.blockAt(pos)
    }
    if (current && current.name !== 'air' && current.boundingBox !== 'empty') return false
    if (current && current.name !== 'air' && current.boundingBox === 'empty') {
      await this.bot.dig(current).catch(() => {})
      current = this.bot.blockAt(pos)
      if (current && current.name !== 'air' && current.boundingBox !== 'empty') return false
    }

    const below = this.bot.blockAt(pos.offset(0, -1, 0))
    if (!below || below.name === 'air' || below.boundingBox === 'empty') return false

    const item = this.bot.inventory.items().find((entry) => entry.name === itemName)
    if (!item) return false

    await this.goTo(new goals.GoalNear(pos.x, pos.y, pos.z, 3), 10000).catch(() => {})
    if (isCancelled()) return false
    await this.bot.equip(item, 'hand').catch(() => {})
    try {
      await this.bot.placeBlock(below, new Vec3(0, 1, 0))
      return this.bot.blockAt(pos)?.name === itemName
    } catch {
      return false
    }
  }

  // O portão fica virado para onde o bot olha ao colocá-lo. O portão fica na
  // parede norte: precisa estar virado norte/sul, senão fica atravessado e deixa
  // fresta. Coloca estando em plan.outside, olhando para o curral, e confere.
  async placePenGate(plan, itemName, isCancelled) {
    const pos = new Vec3(plan.gate.x, plan.gate.y, plan.gate.z)
    const facing = (block) => block?.getProperties?.().facing
    const aligned = (block) => {
      const value = facing(block)
      return value === undefined || value === 'north' || value === 'south'
    }

    for (let attempt = 0; attempt < 2 && !isCancelled(); attempt++) {
      const current = this.bot.blockAt(pos)
      if (current?.name?.endsWith('_fence_gate')) {
        if (aligned(current)) return true
        // Virado de lado: tira para recolocar.
        await this.goTo(new goals.GoalNear(pos.x, pos.y, pos.z, 3), 10000).catch(() => {})
        if (isCancelled()) return false
        await this.bot.dig(current).catch(() => {})
      }

      const out = plan.outside
      await this.goTo(new goals.GoalBlock(out.x, out.y, out.z), 10000).catch(() => {})
      if (isCancelled()) return false
      await this.bot.lookAt?.(pos.offset(0.5, 0.5, 0.5), true)?.catch?.(() => {})
      if (!(await this.placeGroundItem(pos, itemName, isCancelled))) return false
      if (aligned(this.bot.blockAt(pos))) return true
    }
    return false
  }

  // Nivela o interior: um bloco na altura da cerca, encostado nela, vira degrau
  // e os animais pulavam para fora com o portão fechado.
  async levelPenInterior(plan, isCancelled) {
    let leveled = 0
    for (let dx = 1; dx < plan.size - 1 && !isCancelled(); dx++) {
      for (let dz = 1; dz < plan.size - 1 && !isCancelled(); dz++) {
        const block = this.bot.blockAt(new Vec3(plan.origin.x + dx, plan.origin.y, plan.origin.z + dz))
        if (!block || block.boundingBox !== 'block') continue
        await this.goTo(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 3), 8000).catch(() => {})
        if (await this.bot.dig(block).then(() => true, () => false)) leveled++
      }
    }
    return leveled
  }

  async buildAnimalPen(isCancelled, species = 'cow', offset = null) {
    const home = this.homeProvider?.()
    const canonical = husbandry.normalizeSpecies(species) || species
    const plan = groundedPenPlan(this.bot, home, canonical, offset)
    const kit = await this.ensurePenKit(plan)
    if (!kit) throw new Error('não consegui obter cercas e portão suficientes para o curral')

    let leveled = await this.levelPenInterior(plan, isCancelled)

    let fencesPlaced = 0
    for (const position of plan.fences) {
      if (isCancelled()) break
      if (await this.placeGroundItem(position, kit.fence, isCancelled)) fencesPlaced++
    }
    // De novo antes do portão: o pathfinder pode ter posto terra lá dentro durante a obra.
    leveled += await this.levelPenInterior(plan, isCancelled)

    // Acesso ao portão no nível do curral: com a célula da frente 1 bloco mais
    // alta o fazendeiro não conseguia entrar e o portão ficava aberto até o
    // tempo acabar, soltando os animais (visto no 1.20.1).
    const approach = new Vec3(plan.gate.x, plan.gate.y, plan.gate.z - 1)
    for (const pos of [approach, approach.offset(0, 1, 0)]) {
      const block = this.bot.blockAt(pos)
      if (isCancelled() || !NATURAL_TERRAIN.test(block?.name || '')) continue
      await this.goTo(new goals.GoalNear(pos.x, pos.y, pos.z, 3), 8000).catch(() => {})
      await this.bot.dig(block).catch(() => {})
    }

    let gatePlaced = false
    if (!isCancelled()) {
      gatePlaced = await this.placePenGate(plan, kit.gate, isCancelled)
    }

    return {
      ok: !isCancelled() && gatePlaced && fencesPlaced >= plan.fenceCount,
      species: canonical,
      size: plan.size,
      fencesPlaced,
      fencesRequested: plan.fenceCount,
      gatePlaced,
      leveled,
      center: plan.center,
      offset: plan.offset,
      fenceItem: kit.fence,
      gateItem: kit.gate
    }
  }

  async enterAnimalPen(plan, isCancelled) {
    await this.bot.unequip?.('hand').catch?.(() => {})
    if (!(await this.setPenGate(plan, true, isCancelled))) return false
    try {
      const entry = plan.insideEntry
      await this.goTo(new goals.GoalNear(entry.x, entry.y, entry.z, 1), 12000)
    } finally {
      // Cancelado: outra tarefa já controla o pathfinder e fecha o portão ela mesma.
      if (!isCancelled()) await this.setPenGate(plan, false, isCancelled).catch(() => {})
    }
    return !isCancelled() && pointInsidePen(this.bot.entity?.position, plan)
  }

  async withAnimalPen(pen, isCancelled, work) {
    this.useMoves(this.penMoves)
    try {
      const entered = await this.enterAnimalPen(pen.plan, isCancelled)
      if (!entered) throw new Error(`não consegui entrar no curral de ${pen.canonical}`)
      return await work()
    } finally {
      // Se outra tarefa assumiu (cancelamento/defesa) não mexe no pathfinder nem
      // no portão: o run() da próxima tarefa sai do curral pelo portão.
      if (!isCancelled()) {
        if (this.bot.entity && pointInsidePen(this.bot.entity.position, pen.plan)) {
          await this.leaveAnimalPen(pen.plan, isCancelled).catch(() => {})
        } else {
          await this.setPenGate(pen.plan, false, isCancelled).catch(() => {})
        }
        this.useMoves(this.workMoves)
      }
    }
  }

  async waitUntil(check, isCancelled, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    while (!isCancelled()) {
      if (check()) return true
      if (Date.now() >= deadline) return false
      await sleep(this.lure.pollMs)
    }
    return false
  }

  lureDistance(entity) {
    return entity.position.distanceTo(this.bot.entity.position)
  }

  // Espera o animal atraído chegar perto antes de começar a andar.
  async waitForAnimal(entity, isCancelled) {
    return this.waitUntil(
      () => entity.isValid !== false && this.lureDistance(entity) <= this.lure.near,
      isCancelled,
      this.lure.waitMs
    )
  }

  // Anda em trechos curtos até `target` com o animal atrás: se ele ficar a mais
  // de `near` blocos, para e espera ele alcançar. Animal atraído perde o
  // interesse a mais de ~10 blocos, e aí não há o que fazer.
  async leadAnimal(entity, target, isCancelled) {
    const goal = new goals.GoalNear(target.x, target.y, target.z, 1)
    const deadline = Date.now() + this.lure.timeoutMs
    let walking = false
    let waitingSince = null
    try {
      while (!isCancelled() && Date.now() < deadline) {
        if (entity.isValid === false) return false
        const lag = this.lureDistance(entity)
        if (lag > this.lure.lost) return false
        if (lag > this.lure.near) {
          if (walking) this.bot.pathfinder.setGoal(null)
          walking = false
          waitingSince = waitingSince || Date.now()
          if (Date.now() - waitingSince > this.lure.waitMs) return false
        } else {
          waitingSince = null
          if (goal.isEnd(this.bot.entity.position.floored())) return true
          if (!walking) this.bot.pathfinder.setGoal(goal)
          walking = true
        }
        await sleep(this.lure.pollMs)
      }
      return false
    } finally {
      if (walking && !isCancelled()) this.bot.pathfinder.setGoal(null)
    }
  }

  async lureFeed(species) {
    const canonical = husbandry.normalizeSpecies(species) || species
    const config = husbandry.SPECIES[canonical]
    if (!config) throw new Error(`animal não suportado: ${species}`)

    let item = this.bot.inventory.items().find((entry) => config.feed.includes(entry.name))
    if (item) return item

    if (this.storage?.configured()) {
      for (const name of config.feed) {
        const amount = await this.storage.withdraw(this.bot, name, 1).catch(() => 0)
        if (amount > 0) {
          item = this.bot.inventory.items().find((entry) => entry.name === name)
          if (item) return item
        }
      }
    }
    return null
  }

  async setPenGate(plan, open, isCancelled = () => false) {
    const position = new Vec3(plan.gate.x, plan.gate.y, plan.gate.z)
    let gate = this.bot.blockAt(position)
    if (!gate?.name?.endsWith('_fence_gate')) throw new Error('portão do curral não encontrado')

    const current = gate.getProperties?.().open
    if (typeof current === 'boolean' && current === open) {
      this.trackPen(plan, open)
      return true
    }

    await this.goTo(new goals.GoalNear(position.x, position.y, position.z, 3), 10000)
    if (isCancelled()) return false
    await this.bot.activateBlock(gate)
    await sleep(350)
    gate = this.bot.blockAt(position)
    const updated = gate?.getProperties?.().open
    const ok = typeof updated === 'boolean' ? updated === open : true
    if (ok) this.trackPen(plan, open)
    return ok
  }

  // Lembra do curral enquanto o portão está aberto ou o bot está dentro, para
  // a próxima tarefa sair/fechar se esta for cancelada no meio.
  trackPen(plan, open) {
    if (open || pointInsidePen(this.bot.entity?.position, plan)) this.activePen = plan
    else if (this.activePen === plan) this.activePen = null
  }

  async leaveAnimalPen(plan, isCancelled) {
    await this.bot.unequip?.('hand').catch?.(() => {})
    // Os animais acabaram de seguir o fazendeiro e ficam colados nele: abrir o
    // portão na hora deixava um escapar. Espera se afastarem do portão.
    const gateCenter = new Vec3(plan.gate.x + 0.5, plan.gate.y, plan.gate.z + 0.5)
    await this.waitUntil(() => !Object.values(this.bot.entities || {}).some((entity) =>
      entity.name === plan.species && entity.position?.distanceTo(gateCenter) < 2.5
    ), isCancelled, 6000)
    if (!(await this.setPenGate(plan, true, isCancelled))) return false
    try {
      const out = plan.outside
      await this.goTo(new goals.GoalNear(out.x, out.y, out.z, 1), 12000)
      return !isCancelled()
    } finally {
      if (!isCancelled()) await this.setPenGate(plan, false, isCancelled).catch(() => {})
    }
  }

  async captureAnimals(species, count, isCancelled) {
    const pen = this.penContext(species)
    if (!pen) throw new Error('base da colônia ainda não definida')
    if (!pen.status.built) {
      throw new Error(`curral de ${pen.canonical} incompleto: ${pen.status.fencesPresent}/${pen.status.fencesExpected} cercas, portão=${pen.status.gatePresent ? 'ok' : 'ausente'}`)
    }

    const wanted = Math.max(1, Math.min(16, Number.parseInt(count, 10) || 1))
    const feed = await this.lureFeed(pen.canonical)
    if (!feed) {
      return {
        ok: false,
        species: pen.canonical,
        requested: wanted,
        captured: 0,
        reason: 'sem_alimento',
        feed: husbandry.SPECIES[pen.canonical].feed
      }
    }

    const center = new Vec3(pen.plan.center.x, pen.plan.center.y, pen.plan.center.z)
    const candidates = husbandry.selectAnimals(this.bot, pen.canonical, {
      center,
      range: 40,
      filter: (entity) => !pointInsidePen(entity.position, pen.plan)
    })

    let captured = 0
    let attempted = 0
    // Atraindo: sem correr (o animal fica para trás e perde o interesse) e sem cavar.
    this.useMoves(this.penMoves)
    this.bot.setControlState?.('sprint', false)
    try {
      for (const entity of candidates) {
        if (captured >= wanted || isCancelled()) break
        if (entity.isValid === false) continue
        attempted++

        const currentFeed = this.bot.inventory.items().find((entry) => entry.name === feed.name)
        if (!currentFeed) break
        await this.bot.equip(currentFeed, 'hand').catch(() => {})

        await this.goTo(
          new goals.GoalNear(
            Math.floor(entity.position.x),
            Math.floor(entity.position.y),
            Math.floor(entity.position.z),
            3
          ),
          15000
        ).catch(() => {})
        if (isCancelled() || entity.isValid === false) break
        // Com a ração na mão o animal vem até o bot; sem isso não adianta andar.
        if (!(await this.waitForAnimal(entity, isCancelled))) continue
        if (!(await this.leadAnimal(entity, pen.plan.outside, isCancelled))) continue
        if (isCancelled()) break

        let inside = false
        try {
          // Portão aberto só com o animal colado no bot (e o bot já do lado de fora dele).
          if (!(await this.setPenGate(pen.plan, true, isCancelled))) continue
          if (isCancelled()) break

          await this.bot.equip(currentFeed, 'hand').catch(() => {})
          // Vai até o centro para puxar o animal inteiro para dentro antes de fechar.
          await this.leadAnimal(entity, pen.plan.center, isCancelled)
          inside = await this.waitUntil(
            () => entity.isValid !== false && pointInsidePen(entity.position, pen.plan),
            isCancelled,
            1500
          )
        } finally {
          if (!isCancelled()) await this.setPenGate(pen.plan, false, isCancelled).catch(() => {})
        }

        if (inside) captured++
        if (!isCancelled()) await this.leaveAnimalPen(pen.plan, isCancelled).catch(() => {})
      }
    } finally {
      if (!isCancelled()) this.useMoves(this.workMoves)
    }

    const insideNow = husbandry.selectAnimals(this.bot, pen.canonical, {
      center,
      range: pen.plan.size + 2,
      filter: (entity) => pointInsidePen(entity.position, pen.plan)
    }).length

    return {
      ok: captured >= wanted,
      species: pen.canonical,
      requested: wanted,
      attempted,
      captured,
      inside: insideNow,
      feed: feed.name
    }
  }

  nearbyPreparationAllowlist(maxDistance = preparationRadius(), maxTargets = 32) {
    if (typeof this.bot.findBlocks !== 'function') return []
    const blocks = this.bot.registry?.blocksArray || []
    const idsFor = (predicate) => blocks.filter((block) => predicate(block.name)).map((block) => block.id)
    const isStone = (name) => name === 'stone' || name === 'cobblestone'
    const isLog = (name) => name.endsWith('_log')

    // findBlocks devolve os mais próximos primeiro: em terreno natural eles são pedras enterradas ou um
    // afloramento grande que esgotaria a cota e deixaria as árvores de fora. Duas varreduras limitadas,
    // uma por recurso, mantendo só candidatos expostos e no máximo metade da cota para cada.
    const seen = new Set()
    const scan = (predicate, scanCount, cap) => {
      const matching = idsFor(predicate)
      if (!matching.length) return []
      const found = []
      for (const position of this.bot.findBlocks({ matching, maxDistance, count: scanCount }) || []) {
        if (!position || found.length >= cap) break
        const key = position.toString()
        if (seen.has(key)) continue
        const block = this.bot.blockAt?.(position)
        if (!block || !predicate(block.name)) continue
        if (!gather.isExposed(this.bot, position) || gather.hasFallingAbove(this.bot, position)) continue
        seen.add(key)
        found.push({ x: position.x, y: position.y, z: position.z, name: block.name })
      }
      return found
    }
    const half = Math.floor(maxTargets / 2)
    return [...scan(isLog, maxTargets * 4, half), ...scan(isStone, maxTargets * 8, maxTargets - half)]
  }

  // Depois de uma ameaça interromper a preparação, a defesa pode deslocar o bot para fora da janela
  // local. Uma única volta ao local validado (nunca busca nova); o resto é reavaliado pelo snapshot real.
  async returnToPreparationSite(task, isCancelled) {
    const site = this._preparationSite
    if (!site || isCancelled()) return
    if (Date.now() - site.at > PREPARATION_SITE_TTL_MS) { this._preparationSite = null; return }
    const state = preparationStateSnapshot(this.bot, task, { homeProvider: this.homeProvider, allowedTargets: [], isCancelled })
    if (state.threat) return // ameaça ainda presente: mantém o local até o TTL
    this._preparationSite = null
    if (state.equippedWeapon) return
    const distance = this.bot.entity.position.distanceTo(site.position)
    if (distance <= 0.5 || distance > PREPARATION_SITE_MAX_DISTANCE) return
    try {
      await this.goTo(new goals.GoalBlock(Math.floor(site.position.x), Math.floor(site.position.y), Math.floor(site.position.z)), 15000)
    } catch { /* sem caminho: segue com o snapshot real da posição atual */ }
  }

  async tryLocalPreparationStaging(isCancelled) {
    if (isCancelled() || !this.production?.findCraftingTable || !this.bot?.entity?.position) return false

    const table = this.production.findCraftingTable(this.bot, PREPARATION_STAGING_MAX_DISTANCE)
    if (!table?.position) return false

    const liveTable = this.bot.blockAt?.(table.position)
    if (liveTable?.name !== 'crafting_table') return false

    const distance = this.bot.entity.position.distanceTo(table.position)
    if (distance > PREPARATION_STAGING_MAX_DISTANCE) return false

    // The cache is only a hint; the physical executor/preflight still revalidates
    // the block and distance before every craft.
    this.production.rememberCraftingTable?.(this.bot, liveTable)

    // If we are already adjacent, another movement would add no useful physical
    // information. Let the normal fail-closed fallback handle the refusal.
    if (distance <= 1.5) return false

    let stagingThreat = null
    let defenseStarted = false
    const detectThreat = () => {
      if (stagingThreat || isCancelled() || !this.bot?.entity?.position) return
      const threat = this.bot.nearestEntity?.((entity) =>
        entity?.type === 'hostile' &&
        entity.position?.distanceTo(this.bot.entity.position) <= FLEE_DISTANCE
      )
      if (!threat) return

      stagingThreat = threat
      // Cancel the navigation immediately. defend() synchronously invalidates
      // taskVersion before its first await, so the old explore owner cannot
      // start another physical action after this point.
      this.bot.pathfinder?.setGoal(null)
      if (!defenseStarted && !this.defending) {
        defenseStarted = true
        this.defend(threat).catch((err) =>
          this.logger.log?.(`[colônia] ${this.name} defesa durante staging: ${err.message}`)
        )
      }
    }

    detectThreat()
    if (stagingThreat || isCancelled()) return false

    const monitor = setInterval(detectThreat, PREPARATION_STAGING_SAFETY_POLL_MS)
    monitor.unref?.()
    try {
      await this.goTo(
        new goals.GoalNear(
          Math.floor(table.position.x),
          Math.floor(table.position.y),
          Math.floor(table.position.z),
          1
        ),
        10000
      )
    } catch {
      return false
    } finally {
      clearInterval(monitor)
    }

    detectThreat()
    if (stagingThreat || isCancelled()) return false
    const after = this.bot.blockAt?.(table.position)
    if (after?.name !== 'crafting_table') return false
    return this.bot.entity.position.distanceTo(table.position) <= 2
  }

  async runExplorePlayerLoop(task, isCancelled) {
    if (process.env.MBOT_EXPLORE_PREPARATION !== '1') {
      return this.explore(task.radius || 64, isCancelled, task.center || null)
    }

    const preparationSteps = []
    const maxPreparationSteps = 3
    let stagingAttempted = false
    // Muito além do raio de exploração (ex.: respawn no spawn do mundo): os alvos são relativos ao
    // centro, então primeiro volta a ele com o retorno existente em vez de falhar caminhando 300+ blocos.
    const center = task.center || this.homeProvider?.()
    const farLimit = (task.radius || 64) + EXPLORE_FAR_MARGIN
    if (center && this.bot.entity?.position && Math.hypot(this.bot.entity.position.x - center.x, this.bot.entity.position.z - center.z) > farLimit) {
      const returned = await this.returnHome(isCancelled)
      if (!returned.ok) return { ok: false, code: 'CANCELLED', cancelled: true, preparationSteps }
    }
    await this.returnToPreparationSite(task, isCancelled)

    for (let step = 0; step < maxPreparationSteps;) {
      if (isCancelled()) return { ok: false, code: 'CANCELLED', cancelled: true, preparationSteps }

      const allowedTargets = this.nearbyPreparationAllowlist()
      const state = preparationStateSnapshot(this.bot, task, {
        homeProvider: this.homeProvider,
        allowedTargets,
        isCancelled
      })
      const candidates = candidateIntents(state)
      const choice = deterministicPlayerPolicy(state, candidates)

      if (choice === 'continue_objective') {
        const explored = await this.explore(task.radius || 64, isCancelled, task.center || null, { groundAware: true })
        return {
          ...explored,
          playerLoopPreparation: true,
          preparationSteps
        }
      }

      // Noite desarmado (ou outra necessidade de voltar): o retorno à base já existe (tarefa `voltar`);
      // sem ele o explorador ficaria parado fora da base. Um único retorno, sob o mesmo owner.
      if (choice === 'return_base' && this.homeProvider?.()) {
        const returned = await this.returnHome(isCancelled)
        return returned.ok
          ? { ok: true, returnedToBase: true, intent: choice, playerLoopPreparation: true, preparationSteps }
          : { ok: false, code: 'CANCELLED', cancelled: true, preparationSteps }
      }

      if (!['gather_materials', 'prepare_combat', 'equip_best_weapon'].includes(choice)) {
        // Ameaça antes da preparação: lembra o local (desarmado + recursos ao alcance) para uma volta única depois.
        if (state.threat && !state.equippedWeapon && (state.nearby?.wood || state.nearby?.stone)) {
          this._preparationSite = { position: this.bot.entity.position.clone(), at: Date.now() }
        }
        return {
          ok: false,
          code: 'PLAYER_LOOP_PREEMPTED',
          intent: choice,
          candidates: candidates.map((candidate) => candidate.id),
          preparationSteps
        }
      }

      if (process.env.MBOT_DETERMINISTIC_PREPARATION !== '1') {
        return {
          ok: false,
          code: 'PREPARATION_EXECUTOR_DISABLED',
          intent: choice,
          preparationSteps
        }
      }

      // O preflight só aceita mesa já em cache; registra uma mesa real a ≤4 blocos (sem busca ampla).
      if (!this.production.cachedCraftingTable?.(this.bot)) {
        const nearbyTable = this.production.findCraftingTable?.(this.bot, 4)
        if (nearbyTable) this.production.rememberCraftingTable(this.bot, nearbyTable)
      }

      const preflight = preparationIntegrationPreflight({
        bot: this.bot,
        production: this.production,
        state,
        allowedTargets
      })
      if (!preflight.ok) {
        if (preflight.code === 'SAFETY_PRECEDENCE') {
          return { ok: false, code: preflight.code, intent: choice, preparationSteps }
        }

        // One bounded staging move is allowed only for spatial refusals. This is
        // not a resource search: it approaches one existing crafting table at
        // <= 8 blocks, then rebuilds the allowlist/snapshot and re-runs preflight.
        if (!stagingAttempted &&
            ['NEARBY_TABLE_REQUIRED', 'APPROVED_TARGETS_INSUFFICIENT'].includes(preflight.code)) {
          stagingAttempted = true
          if (await this.tryLocalPreparationStaging(isCancelled)) continue
          if (isCancelled()) return { ok: false, code: 'CANCELLED', cancelled: true, preparationSteps }
        }

        // Sem condições físicas para preparar aqui: não é erro da tarefa.
        // Segue o caminho clássico em vez de deixar o explorador parado.
        const explored = await this.explore(task.radius || 64, isCancelled, task.center || null, { groundAware: true })
        return {
          ...explored,
          playerLoopPreparation: true,
          preparationSkipped: { code: preflight.code || 'PREPARATION_PREFLIGHT_REFUSED', intent: choice },
          preparationSteps
        }
      }

      const preparationTask = preparationIntegrationTask({
        enabled: true,
        bot: this.bot,
        production: this.production,
        state,
        objective: task,
        allowedTargets,
        // A caminhada de aproximação (até 8 s) do modo raio >4 faz parte da etapa: sem ela, 2 de 8 rodadas
        // estouravam 20 s com o gather quase pronto (8 s de caminhada + dig + pickup + 2 pedras).
        timeoutMs: 20000 + (preparationRadius() > 4 ? 8000 : 0)
      })
      if (!preparationTask) {
        return {
          ok: false,
          code: 'PREPARATION_TASK_NOT_CREATED',
          intent: choice,
          preparationSteps
        }
      }

      const ownerVersion = this.taskVersion
      const siteBefore = this.bot.entity.position.clone()
      const preparationPromise = this.runDeterministicPreparation(preparationTask, isCancelled)
      this._preparationDrain = preparationPromise
      try {
        const result = await preparationPromise
        preparationSteps.push({
          intent: choice,
          ok: result?.ok === true,
          code: result?.code || null,
          ownerVersion
        })
        if (!result?.ok) {
          if (result?.code === 'THREAT') this._preparationSite = { position: siteBefore, at: Date.now() }
          // Recusa física do executor (alvo coberto por folhas, falta de alvos/picareta/mesa): nada deu errado
          // na tarefa; segue a exploração clássica em vez de virar falha com backoff exponencial.
          if (PHYSICAL_PREPARATION_REFUSALS.has(result?.code)) {
            const explored = await this.explore(task.radius || 64, isCancelled, task.center || null, { groundAware: true })
            return {
              ...explored,
              playerLoopPreparation: true,
              preparationSkipped: { code: result.code, intent: choice, afterStep: true },
              preparationSteps
            }
          }
          return {
            ...result,
            playerLoopPreparation: true,
            preparationSteps
          }
        }
        step++
      } finally {
        if (this._preparationDrain === preparationPromise) this._preparationDrain = null
      }
    }

    const finalTargets = this.nearbyPreparationAllowlist()
    const finalState = preparationStateSnapshot(this.bot, task, {
      homeProvider: this.homeProvider,
      allowedTargets: finalTargets,
      isCancelled
    })
    const finalCandidates = candidateIntents(finalState)
    const finalChoice = deterministicPlayerPolicy(finalState, finalCandidates)
    if (finalChoice === 'continue_objective') {
      const explored = await this.explore(task.radius || 64, isCancelled, task.center || null, { groundAware: true })
      return { ...explored, playerLoopPreparation: true, preparationSteps }
    }

    return {
      ok: false,
      code: 'PREPARATION_STEP_LIMIT',
      intent: finalChoice,
      candidates: finalCandidates.map((candidate) => candidate.id),
      preparationSteps
    }
  }

  // Superfície caminhável em (x, z) perto de nearY a partir dos chunks já carregados. Água/lava na superfície
  // (oceano, lago) ou nenhum chão => inválido; copas de árvore são atravessadas até o chão. unknown: chunk
  // não carregado (mantém o alvo original).
  surfaceAt(x, z, nearY) {
    const top = Math.floor(nearY) + 24
    for (let y = top; y >= Math.floor(nearY) - 32; y--) {
      const block = this.bot.blockAt?.(new Vec3(x, y, z))
      if (!block) return { unknown: true }
      if (block.name === 'water' || block.name === 'lava' || block.name === 'bubble_column') return { ok: false, reason: block.name }
      if (block.boundingBox === 'block' && !block.name.endsWith('_leaves')) return { ok: true, y: y + 1 }
    }
    return { ok: false, reason: 'no_ground' }
  }

  async explore(radius, isCancelled, center = null, { groundAware = false } = {}) {
    const home = center || this.homeProvider?.()
    if (!home) throw new Error('base/centro de exploração ainda não definido')

    const directions = [
      [1, 0], [1, 1], [0, 1], [-1, 1],
      [-1, 0], [-1, -1], [0, -1], [1, -1]
    ]
    const pick = () => {
      const direction = directions[this.exploreStep % directions.length]
      const ring = 1 + Math.floor(this.exploreStep / directions.length)
      this.exploreStep++
      const distance = Math.min(radius, 16 * ring)
      return {
        distance,
        x: Math.floor(home.x + direction[0] * distance),
        z: Math.floor(home.z + direction[1] * distance),
        y: Number.isFinite(Number(home.y)) ? Math.floor(Number(home.y)) : Math.floor(this.bot.entity.position.y)
      }
    }
    let chosen = pick()
    if (groundAware) {
      // Alvos em anel com y fixo caem no ar sobre o oceano ou dentro de rocha em terreno natural; cada tentativa
      // custava ~30 s de pathfinder. Procura a superfície real e passa à próxima direção (sem se mover).
      for (let tries = 0; tries < 8; tries++) {
        const ground = this.surfaceAt(chosen.x, chosen.z, chosen.y)
        if (ground.unknown) break
        if (ground.ok) { chosen.y = ground.y; break }
        chosen = pick()
      }
    }
    const { distance, x, y, z } = chosen

    const target = { x, y, z, radius: distance }
    if (process.env.MBOT_STATEMACHINE === '1') {
      const result = await stateMachineExplore.runExploreStateMachine({
        target,
        move: (point) => this.goTo(new goals.GoalNear(point.x, point.y, point.z, 3), 30000),
        isCancelled,
        logger: this.logger
      })
      if (!result.fallback) {
        return { ...result, x, y, z, radius: distance }
      }
      this.logger.log?.('[statemachine] plugin indisponível; usando exploração clássica')
    }

    await this.goTo(new goals.GoalNear(x, y, z, 3), 30000)
    if (isCancelled()) return { ok: false, cancelled: true }
    return { ok: true, x, y, z, radius: distance, stateMachine: false }
  }

  async goToPoint(position, isCancelled) {
    const x = Number(position?.x)
    const y = Number(position?.y)
    const z = Number(position?.z)
    if (![x, y, z].every(Number.isFinite)) throw new Error('posição de destino inválida')
    const target = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) }
    const center = new Vec3(target.x + 0.5, target.y, target.z + 0.5)
    const deadline = Date.now() + 45000
    let finalDistance = null
    // GoalNear encerra usando coordenadas discretas: goto resolvido não confirma
    // o raio físico. Uma única aproximação mais curta pode corrigir esse desvio.
    for (let attempt = 0; attempt <= 2; attempt++) {
      if (isCancelled()) return { ok: false, verified: false, cancelled: true, ...target }
      const actual = this.bot.entity?.position
      const distance = actual ? actual.distanceTo(center) : Infinity
      finalDistance = Number.isFinite(distance) ? distance : null
      if (distance <= POINT_ARRIVAL_RADIUS) {
        return {
          ok: true,
          verified: true,
          distance,
          ...target,
          evidence: {
            type: 'position_confirmed',
            position: { x: actual.x, y: actual.y, z: actual.z },
            dimension: this.bot.game?.dimension || null,
            target: { x: center.x, y: center.y, z: center.z },
            tolerance: POINT_ARRIVAL_RADIUS,
            distance
          }
        }
      }
      if (attempt === 2 || Date.now() >= deadline) break
      try {
        await this.goTo(new goals.GoalNear(target.x, target.y, target.z, attempt === 0 ? 2 : 1), deadline - Date.now())
      } catch (err) {
        if (isCancelled()) return { ok: false, verified: false, cancelled: true, ...target }
        err.code ||= 'PATH_FAILED'
        throw err
      }
    }
    return {
      ok: false,
      verified: false,
      distance: finalDistance,
      ...target,
      failure: { code: NAVIGATION_POSITION_NOT_CONFIRMED, message: 'Posição final fora do raio de chegada confirmado' }
    }
  }

  async guard(durationMs, isCancelled) {
    await this.ensureRoleTool()
    const deadline = Date.now() + durationMs
    while (Date.now() < deadline && !isCancelled()) {
      const owner = this.ownerProvider?.()
      if (owner?.position) {
        this.bot.pathfinder.setGoal(new goals.GoalFollow(owner, 3), true)
      }

      const hostile = this.bot.nearestEntity((entity) =>
        entity.type === 'hostile' &&
        entity.position?.distanceTo(this.bot.entity.position) <= 8
      )
      if (hostile) {
        const tool = this.bot.inventory.items()
          .find((item) => item.name.endsWith('_sword') || item.name.endsWith('_axe'))
        if (tool) await this.bot.equip(tool, 'hand').catch(() => {})
        if (hostile.position.distanceTo(this.bot.entity.position) <= 3.2) {
          await this.bot.lookAt(hostile.position.offset(0, (hostile.height || 1) / 2, 0), true).catch(() => {})
          this.bot.attack(hostile)
        }
      }
      await sleep(350)
    }
    return { ok: true }
  }

  async returnHome(isCancelled) {
    const home = this.homeProvider?.()
    if (!home) throw new Error('base da colônia ainda não definida')
    const timeoutMs = travelTimeoutMs(this.bot.entity?.position, home)
    await this.goTo(new goals.GoalNear(Math.floor(home.x), Math.floor(home.y), Math.floor(home.z), 3), timeoutMs)
    return { ok: !isCancelled() }
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
        } catch {}
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

  buildingMaterials() {
    const allowed = new Set(this.storage?.buildingMaterialNames?.() || [
      'cobblestone', 'stone', 'deepslate', 'cobbled_deepslate',
      'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
      'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
      'bamboo_planks', 'dirt'
    ])
    return this.bot.inventory.items()
      .filter((item) => allowed.has(item.name) && item.count > 0)
      .sort((a, b) => b.count - a.count)
  }

  buildingMaterial(minimum = 23) {
    return this.buildingMaterials().find((item) => item.count >= minimum) || null
  }

  async placeAt(position, material, isCancelled) {
    if (isCancelled()) return false
    const current = this.bot.blockAt(position)
    if (current && current.name !== 'air' && current.boundingBox !== 'empty') return true

    const faces = [
      new Vec3(0, -1, 0), new Vec3(0, 1, 0),
      new Vec3(-1, 0, 0), new Vec3(1, 0, 0),
      new Vec3(0, 0, -1), new Vec3(0, 0, 1)
    ]

    for (const faceToRef of faces) {
      const refPos = position.plus(faceToRef)
      const reference = this.bot.blockAt(refPos)
      if (!reference || reference.name === 'air' || reference.boundingBox === 'empty') continue
      const face = new Vec3(-faceToRef.x, -faceToRef.y, -faceToRef.z)
      await this.goTo(new goals.GoalNear(position.x, position.y, position.z, 4), 8000).catch(() => {})
      if (isCancelled()) return false
      await this.bot.equip(material, 'hand')
      await this.bot.placeBlock(reference, face)
      return true
    }
    return false
  }


  async ensureHoe() {
    let hoe = this.bot.inventory.items().find((item) => item.name.endsWith('_hoe'))
    if (hoe) return hoe

    if (this.storage?.configured()) {
      await this.storage.withdrawBestTool(this.bot, 'hoe').catch(() => null)
      hoe = this.bot.inventory.items().find((item) => item.name.endsWith('_hoe'))
      if (hoe) return hoe
    }

    if (this.production) {
      for (const name of ['iron_hoe', 'stone_hoe', 'wooden_hoe']) {
        try {
          await this.production.craftInternal(this.bot, name, 1)
          hoe = this.bot.inventory.items().find((item) => item.name === name)
          if (hoe) return hoe
        } catch {}
      }
    }

    return null
  }

  async ensureWaterAt(position, isCancelled) {
    const existing = this.bot.blockAt(position)
    if (existing?.name === 'water') return true

    const waterId = this.bot.registry?.blocksByName?.water?.id
    if (Number.isInteger(waterId)) {
      const nearby = this.bot.findBlock({
        matching: waterId,
        maxDistance: 8,
        point: position
      })
      if (nearby && nearby.position.distanceTo(position) <= 2) return true
    }

    let bucket = this.bot.inventory.items().find((item) => item.name === 'water_bucket')
    if (!bucket && this.storage?.configured()) {
      await this.storage.withdraw(this.bot, 'water_bucket', 1).catch(() => 0)
      bucket = this.bot.inventory.items().find((item) => item.name === 'water_bucket')
    }
    if (!bucket) return false

    const current = this.bot.blockAt(position)
    if (current && current.name !== 'air' && current.name !== 'water') {
      await this.goTo(new goals.GoalNear(position.x, position.y, position.z, 3), 8000).catch(() => {})
      if (isCancelled()) return false
      if (typeof this.bot.canDigBlock !== 'function' || this.bot.canDigBlock(current)) {
        await this.bot.dig(current).catch(() => {})
      }
    }

    const below = this.bot.blockAt(position.offset(0, -1, 0))
    if (!below || below.name === 'air') return false
    await this.goTo(new goals.GoalNear(position.x, position.y, position.z, 3), 8000).catch(() => {})
    if (isCancelled()) return false
    await this.bot.equip(bucket, 'hand')
    await this.bot.activateBlock(below, new Vec3(0, 1, 0)).catch(() => {})
    await sleep(500)
    return this.bot.blockAt(position)?.name === 'water'
  }

  async farmSeedStack() {
    const names = ['wheat_seeds', 'carrot', 'potato', 'beetroot_seeds']
    let item = this.bot.inventory.items().find((entry) => names.includes(entry.name))
    if (item) return item

    if (this.storage?.configured()) {
      for (const name of names) {
        const amount = await this.storage.withdraw(this.bot, name, 16).catch(() => 0)
        if (amount > 0) {
          item = this.bot.inventory.items().find((entry) => entry.name === name)
          if (item) return item
        }
      }
    }
    return null
  }

  async buildFarm(isCancelled, offset = null) {
    const home = this.homeProvider?.()
    if (!home) throw new Error('base da colônia ainda não definida')

    const hoe = await this.ensureHoe()
    if (!hoe) throw new Error('não consegui obter uma enxada para preparar a fazenda')

    const dx = Number(offset?.x ?? 8)
    const dz = Number(offset?.z ?? 8)
    const baseX = Math.floor(home.x) + dx
    const groundY = Math.floor(home.y) - 1
    const baseZ = Math.floor(home.z) + dz
    const center = new Vec3(baseX + 2, groundY, baseZ + 2)
    const irrigated = await this.ensureWaterAt(center, isCancelled)

    let tilled = 0
    let planted = 0
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 5; z++) {
        if (isCancelled()) break
        if (x === 2 && z === 2) continue

        const pos = new Vec3(baseX + x, groundY, baseZ + z)
        let block = this.bot.blockAt(pos)
        if (!block) continue

        if (block.name !== 'farmland') {
          let tillable = ['dirt', 'grass_block', 'dirt_path'].includes(block.name)

          if (!tillable && this.storage?.configured()) {
            let dirt = this.bot.inventory.items().find((item) => item.name === 'dirt')
            if (!dirt) {
              await this.storage.withdraw(this.bot, 'dirt', 1).catch(() => 0)
              dirt = this.bot.inventory.items().find((item) => item.name === 'dirt')
            }

            if (dirt) {
              await this.goTo(new goals.GoalNear(pos.x, pos.y, pos.z, 3), 8000).catch(() => {})
              if (isCancelled()) break
              if (block.name !== 'air' && block.boundingBox !== 'empty') {
                await this.bot.dig(block).catch(() => {})
              }
              const below = this.bot.blockAt(pos.offset(0, -1, 0))
              if (below && below.name !== 'air') {
                await this.bot.equip(dirt, 'hand').catch(() => {})
                await this.bot.placeBlock(below, new Vec3(0, 1, 0)).catch(() => {})
                await sleep(150)
                block = this.bot.blockAt(pos)
                tillable = ['dirt', 'grass_block', 'dirt_path'].includes(block?.name)
              }
            }
          }

          if (!tillable) continue
          await this.goTo(new goals.GoalNear(pos.x, pos.y, pos.z, 3), 8000).catch(() => {})
          if (isCancelled()) break
          await this.bot.equip(hoe, 'hand').catch(() => {})
          await this.bot.activateBlock(block, new Vec3(0, 1, 0)).catch(() => {})
          await sleep(180)
          block = this.bot.blockAt(pos)
        }

        if (block?.name !== 'farmland') continue
        tilled++

        const above = this.bot.blockAt(pos.offset(0, 1, 0))
        if (above && above.name !== 'air') continue
        const seed = await this.farmSeedStack()
        if (!seed) continue

        await this.bot.equip(seed, 'hand').catch(() => {})
        try {
          await this.bot.placeBlock(block, new Vec3(0, 1, 0))
          planted++
        } catch {}
      }
    }

    return {
      ok: irrigated && tilled >= 8 && planted >= 4,
      irrigated,
      tilled,
      planted,
      requestedPlots: 24,
      offset: { x: dx, z: dz }
    }
  }

  async buildMine(isCancelled, length = 12) {
    const home = this.homeProvider?.()
    if (!home) throw new Error('base da colônia ainda não definida')
    await this.ensureRoleTool()

    const names = [
      'stone', 'deepslate', 'cobblestone', 'cobbled_deepslate',
      'coal_ore', 'iron_ore', 'deepslate_coal_ore', 'deepslate_iron_ore'
    ]
    const ids = names
      .map((name) => this.bot.registry?.blocksByName?.[name]?.id)
      .filter(Number.isInteger)
    if (!ids.length) throw new Error('não conheço blocos adequados para abrir a mina')

    const anchor = this.bot.findBlock({ matching: ids, maxDistance: 32 })
    if (!anchor) throw new Error('não encontrei rocha próxima para abrir a mina')

    await this.goTo(new goals.GoalNear(anchor.position.x, anchor.position.y, anchor.position.z, 2), 30000)

    const dx = anchor.position.x >= home.x ? 1 : -1
    const dz = 0
    const wanted = Math.max(6, Math.min(32, Number(length) || 12))
    let clearedSegments = 0
    let dug = 0
    let blockedBy = null

    for (let i = 0; i < wanted && !isCancelled(); i++) {
      const foot = new Vec3(anchor.position.x + dx * i, anchor.position.y, anchor.position.z + dz * i)
      const positions = [foot, foot.offset(0, 1, 0)]
      let segmentOk = true

      // Areia/cascalho no teto (ou na altura da cabeça) desaba no túnel e soterra
      // o bot: encerra o túnel aqui em vez de cavar embaixo.
      if (gather.FALLING.has(this.bot.blockAt(positions[1])?.name) || gather.hasFallingAbove(this.bot, positions[1])) {
        blockedBy = 'areia_cascalho'
        break
      }

      for (const pos of positions) {
        if (isCancelled()) break
        const block = this.bot.blockAt(pos)
        if (!block || block.name === 'air' || block.boundingBox === 'empty') continue

        const tool = this.bot.pathfinder.bestHarvestTool(block)
        if (tool) await this.bot.equip(tool, 'hand').catch(() => {})
        try {
          await this.bot.dig(block)
          dug++
          await this.collectDrops(pos, isCancelled)
        } catch {
          segmentOk = false
        }
      }

      const footNow = this.bot.blockAt(foot)
      const headNow = this.bot.blockAt(foot.offset(0, 1, 0))
      if (segmentOk &&
          (!footNow || footNow.name === 'air' || footNow.boundingBox === 'empty') &&
          (!headNow || headNow.name === 'air' || headNow.boundingBox === 'empty')) {
        clearedSegments++
      }

      if (!isCancelled()) {
        await this.goTo(new goals.GoalNear(foot.x, foot.y, foot.z, 1), 6000).catch(() => {})
      }
    }

    const deposited = this.storage?.configured()
      ? await this.storage.depositCargo(this.bot).catch((err) => { this.logger.log(`[estoque] ${this.name} não depositou: ${err.message}`); return {} })
      : {}

    return {
      ok: clearedSegments >= Math.ceil(wanted * 0.6),
      length: wanted,
      clearedSegments,
      dug,
      blockedBy,
      start: { x: anchor.position.x, y: anchor.position.y, z: anchor.position.z },
      deposited
    }
  }

  async buildHouse(isCancelled, offset = null) {
    const home = this.homeProvider?.()
    if (!home) throw new Error('base da colônia ainda não definida')

    const required = 23
    let materials = this.buildingMaterials()
    let available = materials.reduce((sum, item) => sum + item.count, 0)
    if (available < required && this.storage?.configured()) {
      await this.storage.withdrawBuildingMaterial(this.bot, required - available)
      materials = this.buildingMaterials()
      available = materials.reduce((sum, item) => sum + item.count, 0)
    }
    if (available < required) {
      throw new Error(`preciso de ${required} blocos de construção; tenho ${available}`)
    }

    const dx = Number(offset?.x ?? 5)
    const dz = Number(offset?.z ?? 2)
    const baseX = Math.floor(home.x) + dx
    const baseY = Math.floor(home.y) - 1
    const baseZ = Math.floor(home.z) + dz
    const targets = []

    for (let y = 1; y <= 2; y++) {
      for (let x = 0; x < 3; x++) {
        for (let z = 0; z < 3; z++) {
          const edge = x === 0 || x === 2 || z === 0 || z === 2
          const doorway = z === 0 && x === 1 && (y === 1 || y === 2)
          if (edge && !doorway) targets.push(new Vec3(baseX + x, baseY + y, baseZ + z))
        }
      }
    }
    for (let x = 0; x < 3; x++) {
      for (let z = 0; z < 3; z++) targets.push(new Vec3(baseX + x, baseY + 3, baseZ + z))
    }

    let placed = 0
    const used = {}
    for (const target of targets) {
      if (isCancelled()) break
      const item = this.buildingMaterials()[0]
      if (!item) break
      if (await this.placeAt(target, item, isCancelled).catch(() => false)) {
        placed++
        used[item.name] = (used[item.name] || 0) + 1
      }
    }

    return {
      ok: placed === targets.length,
      placed,
      requested: targets.length,
      materials: used,
      offset: { x: dx, z: dz }
    }
  }

  // Constrói a fatia `task.region` da planta `task.planta` com origem em
  // `task.origin`, levando do estoque central o material da fatia.
  async buildBlueprintRegion(isCancelled, task) {
    if (!task.planta || !task.origin) throw new Error('ordem de planta sem nome ou origem')
    const plan = await blueprint.loadBlueprint(task.planta, { version: this.bot.version || blueprint.DEFAULT_VERSION })
    const region = task.region || null
    const steps = blueprint.stepsForRegion(plan, region)
    const needed = blueprint.materialList(steps).materials
    const origin = { x: Math.floor(task.origin.x), y: Math.floor(task.origin.y), z: Math.floor(task.origin.z) }

    const withdrawn = {}
    const take = async (item, count) => {
      if (!this.storage?.configured() || count <= 0) return 0
      const got = await this.storage.withdraw(this.bot, item, count).catch(() => 0)
      if (got) withdrawn[item] = (withdrawn[item] || 0) + got
      return got
    }
    // Uma ida ao baú no começo; o resto só se acabar no meio da obra.
    const inventory = blueprint.inventoryCounts(this.bot.inventory.items())
    for (const [item, count] of Object.entries(blueprint.missingMaterials(needed, inventory))) {
      if (isCancelled()) break
      await take(item, Math.min(count, 128))
    }

    const report = await buildBlueprint(this.bot, steps, origin, {
      isCancelled,
      clear: blueprint.clearForRegion(plan, region),
      acquire: async (item) => (await take(item, Math.min(64, needed[item] || 1))) > 0,
      log: (msg) => this.logger.log(`[planta] ${this.name} ${msg}`)
    })

    // Sobras voltam para o estoque, para outro construtor ou a próxima tentativa.
    const deposited = this.storage?.configured()
      ? await this.storage.depositCargo(this.bot).catch(() => ({}))
      : {}

    // Material que ainda falta para os blocos que não ficaram prontos.
    // Obstruídos ficam de fora: não adianta esperar material para eles.
    const obstructed = new Set(report.obstructed.map((o) => `${o.x},${o.y},${o.z}`))
    const remainingSteps = steps.filter((step) =>
      !obstructed.has(`${origin.x + step.x},${origin.y + step.y},${origin.z + step.z}`) &&
      !this.blockMatches(origin, step))
    const remaining = blueprint.materialList(remainingSteps).materials
    const missingCount = Object.values(report.missing).reduce((a, b) => a + b, 0)

    return {
      ok: !report.cancelled && report.failed.length === 0 && missingCount === 0,
      planta: task.planta,
      region,
      total: report.total,
      alreadyOk: report.alreadyOk,
      placed: report.placed,
      cleared: report.cleared,
      wrongOrientation: report.wrongOrientation,
      obstructed: report.obstructed,
      failed: report.failed.length,
      missing: report.missing,
      remaining,
      withdrawn,
      deposited,
      durationMs: report.durationMs
    }
  }

  blockMatches(origin, step) {
    const block = this.bot.blockAt(new Vec3(origin.x + step.x, origin.y + step.y, origin.z + step.z))
    return block?.name === step.name
  }
}

module.exports = { WorkerController, protectPenBlocks, shadowObjectiveKey, summarizeGatherRecovery }
