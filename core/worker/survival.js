// @ts-check
// core/worker/survival.js
// Sobrevivência do worker: comer, fugir, lutar, sair de soterramento/água, vigia de progresso.
// Métodos do WorkerController (aplicados ao prototype em core/WorkerController.js).

const { goals } = require('mineflayer-pathfinder')
const food = require('../../lib/food')
const gather = require('../../lib/gather')
const combat = require('../../lib/combat')
const { sleep, HUNGRY, FLEE_DISTANCE, FLEE_MS, CREEPER_RANGE, NO_PROGRESS_MS, NO_PROGRESS_RADIUS, NO_PROGRESS_IDLE_RESET_MS, THREAT_IGNORE_MS } = require('./shared')

class SurvivalBehavior {
  // Sobrevivência entre e durante tarefas: come quando tem fome e foge de creepers.
  /** @this {import('./shared').Worker} */
  survivalTick() {
    if (!this.bot.entity || this.defending) return
    const creeper = this.bot.nearestEntity((e) => combat.EXPLOSIVE.has(e.name) &&
      e.position.distanceTo(this.bot.entity.position) <= CREEPER_RANGE)
    if (creeper) {
      this.defend(creeper).catch(() => {})
      return
    }
    // Below 18 food the injured worker cannot naturally regenerate. Match the
    // companion's recovery threshold, keeping eat()'s safe-food/concurrency guards.
    const needsFood = this.bot.food <= HUNGRY || (this.bot.food < 18 && this.bot.health < 20)
    if (needsFood && !this.bot.targetDigBlock) this.eat()
    this.progressTick()
  }

  // Vigia genérico de falta de progresso: não decide nada sobre o jogo, só registra o que o worker fazia e o libera
  // (cancel → ocioso; quem dá tarefas assume de novo, com estado novo).
  /** @this {import('./shared').Worker} */
  progressTick(now = Date.now()) {
    const position = this.bot.entity?.position
    if (!position || this._sheltered || this.bot.isSleeping) {
      this._progressAnchor = null
      return false
    }
    // Ociosidade curta entre tarefas não zera a contagem: visto no Minecraft (linha de base), 384 ciclos curtos de
    // find_food recusado no mesmo lugar por 38 min, cada um terminando em 'ocioso' por alguns segundos.
    if (this.state !== 'trabalhando') {
      this._idleSince ??= now
      if (now - this._idleSince > NO_PROGRESS_IDLE_RESET_MS) this._progressAnchor = null
      return false
    }
    this._idleSince = null
    if (!this._progressAnchor || position.distanceTo(this._progressAnchor.position) > NO_PROGRESS_RADIUS) {
      this._progressAnchor = { position: position.clone(), at: now }
      return false
    }
    if (now - this._progressAnchor.at < NO_PROGRESS_MS) return false
    const goal = this.bot.pathfinder?.goal
    this.logger.log?.(`[colônia] ${this.name} sem progresso ${Math.round((now - this._progressAnchor.at) / 60000)} min em ${position.floored()}: ` +
      `tarefa=${this.currentTask?.type || '-'} intenção=${this._loopIntent || '-'} caminho=${goal ? goal.constructor?.name : 'nenhum'} ` +
      `movendo=${Boolean(this.bot.pathfinder?.isMoving?.())} cavando=${Boolean(this.bot.targetDigBlock)} vida=${this.bot.health} fome=${this.bot.food}`)
    this._progressAnchor = null
    this.cancel()
    return true
  }

  // Bloco sólido e cavável na altura dos olhos: o bot está sufocando.
  /** @this {import('./shared').Worker} */
  headBlock() {
    const position = this.bot.entity?.position
    if (!position) return null
    const block = this.bot.blockAt(position.offset(0, 1.62, 0))
    return block && block.boundingBox === 'block' && block.diggable !== false ? block : null
  }

  /** @this {import('./shared').Worker} */
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

  /** @this {import('./shared').Worker} */
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
  /** @this {import('./shared').Worker} */
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

  // Chão firme mais próximo fora d'água (até 16 blocos): bloco sólido com 2 de ar livre (sem líquido) em cima.
  /** @this {import('./shared').Worker} */
  dryLand(radius = 16) {
    const here = this.bot.entity.position.floored()
    const free = (b) => b && b.boundingBox === 'empty' && !['water', 'lava', 'bubble_column'].includes(b.name)
    for (let r = 1; r <= radius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
          for (let dy = 4; dy >= -3; dy--) {
            const p = here.offset(dx, dy, dz)
            const floor = this.bot.blockAt(p.offset(0, -1, 0))
            if (floor?.boundingBox === 'block' && free(this.bot.blockAt(p)) && free(this.bot.blockAt(p.offset(0, 1, 0)))) return p
          }
        }
      }
    }
    return null
  }

  /** @this {import('./shared').Worker} */
  async escapeWater(isCancelled) {
    const land = this.dryLand()
    this.bot.setControlState?.('jump', true)
    try {
      if (land && !isCancelled()) await this.goTo(new goals.GoalBlock(land.x, land.y, land.z), 15000).catch(() => {})
      else await sleep(2000)
    } finally {
      this.bot.setControlState?.('jump', false)
    }
    return !this.bot.entity?.isInWater
  }

  /** @this {import('./shared').Worker} */
  async flee(threat, isCancelled) {
    this.bot.pathfinder.setGoal(new goals.GoalInvert(new goals.GoalFollow(threat, FLEE_DISTANCE)), true)
    const until = Date.now() + FLEE_MS
    while (Date.now() < until && !isCancelled()) await sleep(200)
  }

  /** @this {import('./shared').Worker} */
  hostileNear(range = 16) {
    const position = this.bot.entity?.position
    return Boolean(position && this.bot.nearestEntity?.((e) => e?.type === 'hostile' && e.position?.distanceTo(position) <= range))
  }

  /** @this {import('./shared').Worker} */
  huntFailed(entity) {
    return this._failedHunts?.get(entity?.id) > Date.now()
  }

  /** @this {import('./shared').Worker} */
  ignoreThreat(entity, ms = THREAT_IGNORE_MS) {
    if (entity?.id != null) (this._ignoredThreats ||= new Map()).set(entity.id, Date.now() + ms)
  }

  /** @this {import('./shared').Worker} */
  threatIgnored(entity) {
    const until = this._ignoredThreats?.get(entity?.id)
    if (!until) return false
    if (Date.now() < until) return true
    this._ignoredThreats.delete(entity.id)
    return false
  }
}

module.exports = { SurvivalBehavior }
