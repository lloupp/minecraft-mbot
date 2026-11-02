// @ts-check
const { goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')

const CONTAINER_NAMES = ['chest', 'trapped_chest', 'barrel']

function aggregateItems(items) {
  const counts = {}
  for (const item of items || []) {
    if (!item?.name) continue
    counts[item.name] = (counts[item.name] || 0) + (item.count || 0)
  }
  return counts
}

function isEquipment(name) {
  return /_(pickaxe|axe|shovel|hoe|sword|helmet|chestplate|leggings|boots)$/.test(name) ||
    ['shield', 'bow', 'crossbow', 'elytra', 'shears', 'flint_and_steel'].includes(name)
}

// Snapshot barato e somente leitura: capturado ANTES de pedir windowOpen e
// novamente após falha. Sem retry automático: um open tardio não deve causar
// duas janelas/duas operações de estoque concorrentes.
function containerInteractionSnapshot(bot, block) {
  const p = bot?.entity?.position
  const target = block?.position
  const point = (v) => v ? { x: v.x, y: v.y, z: v.z } : null
  const snapshot = {
    block: block?.name || null,
    target: point(target),
    botPosition: point(p),
    dimension: bot?.game?.dimension || null,
    currentWindow: Boolean(bot?.currentWindow),
    sneaking: null,
    eyeDistance: null,
    reachDistance: null,
    visible: null,
    above: null,
    neighbors: {}
  }
  if (!p || !target) return snapshot
  try {
    if (typeof bot.getControlState === 'function') snapshot.sneaking = Boolean(bot.getControlState('sneak'))
  } catch { /* só diagnóstico */ }
  const eye = new Vec3(p.x, p.y + (snapshot.sneaking ? 1.27 : 1.62), p.z)
  const tx = Number(target.x), ty = Number(target.y), tz = Number(target.z)
  if ([tx, ty, tz].every(Number.isFinite)) {
    snapshot.eyeDistance = Number(eye.distanceTo(new Vec3(tx + 0.5, ty + 0.5, tz + 0.5)).toFixed(3))
    const axisGap = (v, min) => Math.max(min - v, 0, v - (min + 1))
    snapshot.reachDistance = Number(Math.hypot(axisGap(eye.x, tx), axisGap(eye.y, ty), axisGap(eye.z, tz)).toFixed(3))
    if (typeof bot.blockAt === 'function') {
      const sample = (dx, dy, dz) => {
        try {
          const b = bot.blockAt(new Vec3(tx + dx, ty + dy, tz + dz))
          return b ? { name: b.name || null, boundingBox: b.boundingBox || null } : null
        } catch { return null }
      }
      snapshot.above = sample(0, 1, 0)
      snapshot.neighbors = {
        north: sample(0, 0, -1), south: sample(0, 0, 1),
        west: sample(-1, 0, 0), east: sample(1, 0, 0)
      }
    }
  }
  try {
    if (typeof bot.canSeeBlock === 'function') snapshot.visible = Boolean(bot.canSeeBlock(block))
  } catch { /* só diagnóstico */ }
  return snapshot
}

class StorageManager {
  constructor() {
    this.position = null
    this._lock = Promise.resolve()
    this._botQueues = new WeakMap()
    this._snapshot = {}
    this.lastUpdatedAt = 0
  }

  configured() {
    return Boolean(this.position)
  }

  setPosition(position) {
    if (!position) {
      this.position = null
      this._snapshot = {}
      this.lastUpdatedAt = 0
      return null
    }
    this.position = {
      x: Math.floor(position.x),
      y: Math.floor(position.y),
      z: Math.floor(position.z)
    }
    this._snapshot = {}
    this.lastUpdatedAt = 0
    return { ...this.position }
  }

  updateSnapshot(items) {
    this._snapshot = aggregateItems(items)
    this.lastUpdatedAt = Date.now()
    return this.cachedSummary()
  }

  cachedSummary() {
    return { ...this._snapshot }
  }

  snapshotAgeMs() {
    return this.lastUpdatedAt ? Date.now() - this.lastUpdatedAt : Infinity
  }

  snapshotFresh(maxAgeMs = 30000) {
    return this.snapshotAgeMs() <= maxAgeMs
  }

  getPosition() {
    return this.position ? { ...this.position } : null
  }

  findNearby(bot, maxDistance = 8) {
    const ids = CONTAINER_NAMES
      .map((name) => bot.registry?.blocksByName?.[name]?.id)
      .filter(Number.isInteger)
    if (!ids.length) return null
    return bot.findBlock({ matching: ids, maxDistance })
  }

  configureNearest(bot, maxDistance = 8) {
    const block = this.findNearby(bot, maxDistance)
    if (!block) throw new Error(`nenhum baú/barrel encontrado em ${maxDistance} blocos`)
    this.setPosition(block.position)
    return block
  }

  block(bot) {
    if (!this.position) throw new Error('estoque central ainda não foi definido')
    const block = bot.blockAt(new Vec3(this.position.x, this.position.y, this.position.z))
    if (!block || !CONTAINER_NAMES.includes(block.name)) {
      throw new Error('o container configurado para o estoque não está disponível')
    }
    return block
  }

  async goNear(bot, position, timeoutMs = null) {
    if (!bot.pathfinder) throw new Error('pathfinder indisponível')
    // Longe da base, 15 s não bastam: ~700 ms por bloco, como nas viagens dos workers.
    if (timeoutMs == null) {
      const from = bot.entity?.position
      const distance = from ? Math.hypot(from.x - position.x, from.y - position.y, from.z - position.z) : 0
      timeoutMs = Math.max(15000, Math.round(distance * 700))
    }
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        bot.pathfinder.setGoal(null)
        reject(new Error('demorei demais para chegar ao estoque'))
      }, timeoutMs)
    })
    try {
      await Promise.race([
        bot.pathfinder.goto(new goals.GoalNear(position.x, position.y, position.z, 2)),
        timeout
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  async withContainer(bot, fn) {
    // Um bot faz uma operação de baú por vez: duas ao mesmo tempo trocariam o
    // objetivo do pathfinder uma da outra ("The goal was changed...").
    const previousOwn = this._botQueues.get(bot) || Promise.resolve()
    /** @type {(value?: any) => void} */
    let releaseOwn
    const own = new Promise((resolve) => { releaseOwn = resolve })
    this._botQueues.set(bot, own)
    await previousOwn

    try {
      // Anda até o baú antes de entrar na fila: a trava só cobre abrir e mexer
      // nos itens, para um bot longe não segurar os outros enquanto caminha.
      // Vai pela posição salva: longe da base o chunk do baú ainda não está
      // carregado e this.block() falharia antes de o bot sair do lugar.
      if (!this.position) throw new Error('estoque central ainda não foi definido')
      await this.goNear(bot, this.position)

      const previous = this._lock
      /** @type {(value?: any) => void} */
      let release
      this._lock = new Promise((resolve) => { release = resolve })
      await previous

      let container
      try {
        const block = this.block(bot)
        const beforeOpen = containerInteractionSnapshot(bot, block)
        try {
          container = await bot.openContainer(block)
        } catch (error) {
          // A mensagem original (inclusive windowOpen timeout) continua sendo
          // propagada: os dados extras permitem separar alcance, obstrução,
          // sneak e janela já aberta sem atribuir causa não comprovada.
          const diagnostic = {
            worker: bot.username || null,
            error: error?.message || String(error),
            before: beforeOpen,
            after: containerInteractionSnapshot(bot, block)
          }
          if (error && typeof error === 'object') error.storageDiagnostics = diagnostic
          console.warn(`[estoque] container_open_failed ${JSON.stringify(diagnostic)}`)
          throw error
        }
        return await fn(container)
      } finally {
        try { container?.close() } catch { /* o container pode já ter sido fechado pelo servidor */ }
        release()
      }
    } finally {
      releaseOwn()
      if (this._botQueues.get(bot) === own) this._botQueues.delete(bot)
    }
  }


  async summary(bot) {
    return this.withContainer(bot, async (container) => this.updateSnapshot(container.containerItems()))
  }

  async count(bot, itemName) {
    const counts = await this.summary(bot)
    return counts[itemName] || 0
  }

  async withdraw(bot, itemName, count = 1) {
    const wanted = Math.max(1, Number(count) || 1)
    return this.withContainer(bot, async (container) => {
      const available = container.containerItems()
        .filter((item) => item.name === itemName)
        .reduce((sum, item) => sum + item.count, 0)
      const amount = Math.min(wanted, available)
      if (amount <= 0) return 0
      const sample = container.containerItems().find((item) => item.name === itemName)
      await container.withdraw(sample.type, null, amount)
      this.updateSnapshot(container.containerItems())
      return amount
    })
  }

  async withdrawFirst(bot, names, count = 1) {
    const wanted = Math.max(1, Number(count) || 1)
    return this.withContainer(bot, async (container) => {
      const items = container.containerItems()
      for (const name of names) {
        const available = items.filter((item) => item.name === name)
          .reduce((sum, item) => sum + item.count, 0)
        if (available < wanted) continue
        const sample = items.find((item) => item.name === name)
        await container.withdraw(sample.type, null, wanted)
        this.updateSnapshot(container.containerItems())
        return { name, count: wanted }
      }
      return null
    })
  }

  async deposit(bot, itemName, count = null) {
    return this.withContainer(bot, async (container) => {
      const stacks = bot.inventory.items().filter((item) => item.name === itemName)
      const available = stacks.reduce((sum, item) => sum + item.count, 0)
      const amount = Math.min(count == null ? available : Math.max(0, Number(count) || 0), available)
      if (amount <= 0) return 0
      await container.deposit(stacks[0].type, null, amount)
      this.updateSnapshot(container.containerItems())
      return amount
    })
  }

  reserveFor(bot, item) {
    if (isEquipment(item.name)) return item.count
    if (bot.registry?.foodsByName?.[item.name]) return Math.min(item.count, 8)
    if (item.name === 'torch') return Math.min(item.count, 16)
    return 0
  }

  async depositCargo(bot) {
    if (!this.configured()) return {}
    const deposited = {}
    const snapshot = bot.inventory.items().map((item) => ({
      name: item.name,
      type: item.type,
      count: item.count,
      keep: this.reserveFor(bot, item)
    }))

    await this.withContainer(bot, async (container) => {
      for (const item of snapshot) {
        const amount = Math.max(0, item.count - item.keep)
        if (!amount) continue
        try {
          await container.deposit(item.type, null, amount)
          deposited[item.name] = (deposited[item.name] || 0) + amount
        } catch {
          // Um container cheio não deve apagar o resultado da tarefa do worker.
        }
      }
      this.updateSnapshot(container.containerItems())
    })
    return deposited
  }

  async withdrawBestTool(bot, kind) {
    const suffix = String(kind || '').replace(/^_/, '')
    const order = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden']
      .map((tier) => `${tier}_${suffix}`)
    return this.withdrawFirst(bot, order, 1)
  }

  buildingMaterialNames() {
    return [
      'cobblestone', 'stone', 'deepslate', 'cobbled_deepslate',
      'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
      'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
      'bamboo_planks', 'dirt'
    ]
  }

  async withdrawBuildingMaterial(bot, count = 23) {
    const wanted = Math.max(1, Number(count) || 1)
    return this.withContainer(bot, async (container) => {
      const withdrawn = {}
      let remaining = wanted

      for (const name of this.buildingMaterialNames()) {
        if (remaining <= 0) break
        const items = container.containerItems()
        const available = items
          .filter((item) => item.name === name)
          .reduce((sum, item) => sum + item.count, 0)
        if (available <= 0) continue

        const amount = Math.min(remaining, available)
        const sample = items.find((item) => item.name === name)
        await container.withdraw(sample.type, null, amount)
        withdrawn[name] = (withdrawn[name] || 0) + amount
        remaining -= amount
      }

      this.updateSnapshot(container.containerItems())
      return {
        requested: wanted,
        withdrawn: wanted - remaining,
        complete: remaining === 0,
        items: withdrawn
      }
    })
  }
}

module.exports = { StorageManager, CONTAINER_NAMES, aggregateItems, isEquipment, containerInteractionSnapshot }
