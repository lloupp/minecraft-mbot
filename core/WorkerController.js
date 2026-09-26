const { Movements, goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const food = require('../lib/food')
const { resolveBlockNames } = require('./resources')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class WorkerController {
  constructor({ bot, name, role, homeProvider, ownerProvider, logger = console }) {
    this.bot = bot
    this.name = name
    this.role = role
    this.homeProvider = homeProvider
    this.ownerProvider = ownerProvider
    this.logger = logger
    this.state = 'conectando'
    this.currentTask = null
    this.taskVersion = 0
    this.exploreStep = 0
    this.workMoves = null

    bot.once('spawn', () => {
      this.workMoves = new Movements(bot)
      this.workMoves.canDig = true
      this.workMoves.allow1by1towers = false
      bot.pathfinder.setMovements(this.workMoves)
      this.state = 'ocioso'
    })

    bot.once('end', () => {
      this.taskVersion++
      this.state = 'desconectado'
      this.currentTask = null
    })
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
    this.cancel()
    const version = this.taskVersion
    const isCancelled = () => version !== this.taskVersion
    this.currentTask = { ...task }
    this.state = 'trabalhando'

    try {
      let result
      switch (task.type) {
        case 'coletar_blocos':
          result = await this.gatherBlocks(task.resource, task.count || 1, isCancelled)
          break
        case 'fazenda':
          result = await this.farm(task.count || 1, isCancelled)
          break
        case 'explorar':
          result = await this.explore(task.radius || 64, isCancelled)
          break
        case 'guardar':
          result = await this.guard(task.durationMs || 20000, isCancelled)
          break
        case 'construir_casa':
          result = await this.buildHouse(isCancelled)
          break
        case 'voltar':
          result = await this.returnHome(isCancelled)
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

  async collectDrops(center, isCancelled) {
    await sleep(450)
    const drops = Object.values(this.bot.entities || {})
      .filter((entity) => entity.name === 'item' && entity.position?.distanceTo(center) <= 6)
    for (const drop of drops) {
      if (isCancelled() || drop.isValid === false) return
      const p = drop.position
      await this.goTo(new goals.GoalNear(p.x, p.y, p.z, 1), 5000).catch(() => {})
    }
  }

  async gatherBlocks(resource, count, isCancelled) {
    const names = resolveBlockNames(this.bot, resource, this.role)
    if (!names.length) throw new Error(`não conheço o recurso "${resource}"`)
    const ids = names.map((name) => this.bot.registry.blocksByName[name]?.id).filter(Number.isInteger)
    if (!ids.length) throw new Error(`nenhum bloco compatível com "${resource}"`)

    let gathered = 0
    while (gathered < count && !isCancelled()) {
      const block = this.bot.findBlock({
        matching: ids,
        maxDistance: 48
      })
      if (!block) break

      await this.goTo(new goals.GoalGetToBlock(block.position.x, block.position.y, block.position.z))
      if (isCancelled()) break

      const fresh = this.bot.blockAt(block.position)
      if (!fresh || fresh.name === 'air') continue
      const tool = this.bot.pathfinder.bestHarvestTool(fresh)
      if (tool) await this.bot.equip(tool, 'hand').catch(() => {})
      await this.bot.dig(fresh)
      gathered++
      await this.collectDrops(block.position, isCancelled)
    }

    return { ok: gathered > 0, gathered, requested: count, resource, exhausted: gathered < count }
  }

  async farm(count, isCancelled) {
    let gathered = 0
    while (gathered < count && !isCancelled()) {
      const result = await food.gatherFood(this.bot, isCancelled)
      if (!result) break
      gathered++
    }
    return { ok: gathered > 0, gathered, requested: count, resource: 'comida', exhausted: gathered < count }
  }

  async explore(radius, isCancelled) {
    const home = this.homeProvider?.()
    if (!home) throw new Error('base da colônia ainda não definida')

    const directions = [
      [1, 0], [1, 1], [0, 1], [-1, 1],
      [-1, 0], [-1, -1], [0, -1], [1, -1]
    ]
    const direction = directions[this.exploreStep % directions.length]
    const ring = 1 + Math.floor(this.exploreStep / directions.length)
    this.exploreStep++
    const distance = Math.min(radius, 16 * ring)
    const x = Math.floor(home.x + direction[0] * distance)
    const z = Math.floor(home.z + direction[1] * distance)
    const y = Math.floor(this.bot.entity.position.y)

    await this.goTo(new goals.GoalNear(x, y, z, 3), 30000)
    if (isCancelled()) return { ok: false, cancelled: true }
    return { ok: true, x, y, z, radius: distance }
  }

  async guard(durationMs, isCancelled) {
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
    await this.goTo(new goals.GoalNear(Math.floor(home.x), Math.floor(home.y), Math.floor(home.z), 3), 30000)
    return { ok: !isCancelled() }
  }

  buildingMaterial(minimum = 23) {
    const allowed = new Set([
      'cobblestone', 'stone', 'oak_planks', 'spruce_planks', 'birch_planks',
      'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks',
      'cherry_planks', 'bamboo_planks', 'dirt'
    ])
    return this.bot.inventory.items()
      .filter((item) => allowed.has(item.name) && item.count >= minimum)
      .sort((a, b) => b.count - a.count)[0] || null
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

  async buildHouse(isCancelled) {
    const home = this.homeProvider?.()
    if (!home) throw new Error('base da colônia ainda não definida')
    const material = this.buildingMaterial(23)
    if (!material) throw new Error('preciso de pelo menos 23 blocos de construção no inventário')

    const baseX = Math.floor(home.x) + 5
    const baseY = Math.floor(home.y)
    const baseZ = Math.floor(home.z) + 2
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
    for (const target of targets) {
      if (isCancelled()) break
      const item = this.bot.inventory.items().find((entry) => entry.name === material.name)
      if (!item) break
      if (await this.placeAt(target, item, isCancelled).catch(() => false)) placed++
    }

    return { ok: placed > 0, placed, requested: targets.length, material: material.name }
  }
}

module.exports = { WorkerController }
