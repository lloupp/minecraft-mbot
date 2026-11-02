// @ts-check
// core/worker/navigation.js
// Navegação: goTo com timeout, chegada confirmada, cavar para sair, guarda e volta à base.
// Métodos do WorkerController (aplicados ao prototype em core/WorkerController.js).

const { Movements, goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const { sleep, POINT_ARRIVAL_RADIUS, DIG_ESCAPE_MS, GOTO_REJECTED_MOVES, UNREACHED_MOVE, NAVIGATION_POSITION_NOT_CONFIRMED, travelTimeoutMs, protectPenBlocks } = require('./shared')

class NavigationBehavior {
  /** @this {import('./shared').Worker} */
  async goTo(goal, timeoutMs = 20000) {
    let timer
    let onForcedMove = null
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        this.bot.pathfinder.setGoal(null)
        reject(new Error('caminho demorou demais'))
      }, timeoutMs)
      // Num degrau em diagonal a física do cliente pode pôr a caixa do bot dentro do bloco: o servidor devolve a
      // posição a cada tick e o pathfinder repete o mesmo passo até o timeout. Sem progresso, desiste cedo.
      let streak = 0
      let anchor = null
      let last = 0
      onForcedMove = () => {
        const position = this.bot.entity?.position
        const now = Date.now()
        if (!position) return
        if (!anchor || now - last > 500 || position.distanceTo(anchor) > 0.5) { anchor = position.clone(); streak = 0 }
        last = now
        if (++streak < GOTO_REJECTED_MOVES) return
        this.bot.pathfinder.setGoal(null)
        reject(new Error('servidor rejeitou o movimento'))
      }
      this.bot.on?.('forcedMove', onForcedMove)
    })
    try {
      await Promise.race([this.bot.pathfinder.goto(goal), timeout])
    } finally {
      clearTimeout(timer)
      this.bot.removeListener?.('forcedMove', onForcedMove)
    }
  }

  /** @this {import('./shared').Worker} */
  arrivedAt(goal) {
    const position = this.bot.entity?.position
    if (!position || typeof goal?.isEnd !== 'function') return true
    return goal.isEnd(position.floored()) || goal.isEnd(position.floored().offset(0, 1, 0))
  }

  /** @this {import('./shared').Worker} */
  async goToWithDigging(goal, timeoutMs) {
    const escape = new Movements(this.bot)
    escape.canDig = true
    escape.allow1by1towers = true
    // Visto no Minecraft: o primeiro nó do caminho era um pulo de parkour que o bot não acerta; o pathfinder
    // reseta por "stuck" e replaneja o mesmo pulo até o timeout. Na tentativa de escape não há parkour.
    escape.allowParkour = false
    protectPenBlocks(escape, this.bot.registry)
    this.logger.log?.(`[colônia] ${this.name} sem caminho sem cavar; tentando uma vez cavando`)
    this.bot.pathfinder.setMovements(escape)
    try {
      await this.goTo(goal, timeoutMs)
    } finally {
      if (this.workMoves) this.bot.pathfinder.setMovements(this.workMoves)
    }
  }

  /** @this {import('./shared').Worker} */
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
        this.observeWorld()
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

  /** @this {import('./shared').Worker} */
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

  /** @this {import('./shared').Worker} */
  async returnHome(isCancelled, { verify = false } = {}) {
    const home = this.homeProvider?.()
    if (!home) throw new Error('base da colônia ainda não definida')
    const timeoutMs = travelTimeoutMs(this.bot.entity?.position, home)
    const goal = new goals.GoalNear(Math.floor(home.x), Math.floor(home.y), Math.floor(home.z), 3)
    try {
      await this.goTo(goal, timeoutMs)
    } catch (err) {
      // Player loop: troca de dono no meio do retorno é cancelamento (como na perna de exploração), não erro.
      if (verify && isCancelled()) return { ok: false }
      if (!verify || !UNREACHED_MOVE.test(err?.message || '')) throw err
    }
    // Player loop: o goto do mineflayer-pathfinder resolve como sucesso quando o caminho parcial é vazio (sem
    // progresso possível). Visto no Minecraft: 41 return_base "ok" seguidos sem o bot sair do lugar. Confere a chegada,
    // tenta uma vez podendo cavar e, se ainda não chegou, diz isso.
    if (verify && !isCancelled() && !this.arrivedAt(goal)) {
      await this.goToWithDigging(goal, DIG_ESCAPE_MS).catch(() => {})
      if (!isCancelled() && !this.arrivedAt(goal)) return { ok: false, code: 'NOT_ARRIVED' }
    }
    if (!isCancelled() && this.worldMemory && this.bot.entity?.position?.distanceTo(home) <= 6) {
      this.worldMemory.confirmLandmark('base')
      this.observeWorld()
    }
    return { ok: !isCancelled() }
  }
}

module.exports = { NavigationBehavior }
