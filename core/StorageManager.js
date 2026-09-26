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

class StorageManager {
  constructor() {
    this.position = null
    this._lock = Promise.resolve()
  }

  configured() {
    return Boolean(this.position)
  }

  setPosition(position) {
    if (!position) {
      this.position = null
      return null
    }
    this.position = {
      x: Math.floor(position.x),
      y: Math.floor(position.y),
      z: Math.floor(position.z)
    }
    return { ...this.position }
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

  async goNear(bot, position, timeoutMs = 15000) {
    if (!bot.pathfinder) throw new Error('pathfinder indisponível')
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
    const previous = this._lock
    let release
    this._lock = new Promise((resolve) => { release = resolve })
    await previous

    let container
    try {
      const block = this.block(bot)
      await this.goNear(bot, block.position)
      container = await bot.openContainer(block)
      return await fn(container)
    } finally {
      try { container?.close() } catch {}
      release()
    }
  }

  async summary(bot) {
    return this.withContainer(bot, async (container) => aggregateItems(container.containerItems()))
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
    })
    return deposited
  }

  async withdrawBestTool(bot, kind) {
    const suffix = String(kind || '').replace(/^_/, '')
    const order = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden']
      .map((tier) => `${tier}_${suffix}`)
    return this.withdrawFirst(bot, order, 1)
  }

  async withdrawBuildingMaterial(bot, count = 23) {
    const names = [
      'cobblestone', 'stone',
      'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
      'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
      'bamboo_planks', 'dirt'
    ]
    return this.withdrawFirst(bot, names, count)
  }
}

module.exports = { StorageManager, CONTAINER_NAMES, aggregateItems, isEquipment }
