const { goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')

const ITEM_ALIASES = {
  picareta_madeira: 'wooden_pickaxe',
  picareta_pedra: 'stone_pickaxe',
  picareta_ferro: 'iron_pickaxe',
  picareta_diamante: 'diamond_pickaxe',
  machado_madeira: 'wooden_axe',
  machado_pedra: 'stone_axe',
  machado_ferro: 'iron_axe',
  machado_diamante: 'diamond_axe',
  espada_ferro: 'iron_sword',
  bancada: 'crafting_table',
  bau: 'chest',
  baú: 'chest'
}

function normalizeItemName(value) {
  const normalized = String(value || '')
    .trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_')
  return ITEM_ALIASES[normalized] || normalized
}

function recipeIngredients(recipe, runs = 1) {
  return (recipe?.delta || [])
    .filter((delta) => delta.count < 0)
    .map((delta) => ({
      id: delta.id,
      metadata: delta.metadata ?? null,
      count: Math.abs(delta.count) * runs
    }))
}

class ProductionManager {
  constructor({ storage }) {
    this.storage = storage
  }

  findCraftingTable(bot, maxDistance = 16) {
    const id = bot.registry?.blocksByName?.crafting_table?.id
    if (!Number.isInteger(id)) return null
    return bot.findBlock({ matching: id, maxDistance })
  }

  async ensureCraftingTable(bot, depth = 0, trail = new Set()) {
    let table = this.findCraftingTable(bot)
    if (table) return table

    let tableItem = bot.inventory.items().find((item) => item.name === 'crafting_table')
    if (!tableItem && this.storage?.configured()) {
      await this.storage.withdraw(bot, 'crafting_table', 1)
      tableItem = bot.inventory.items().find((item) => item.name === 'crafting_table')
    }
    if (!tableItem) {
      await this.craftInternal(bot, 'crafting_table', 1, depth + 1, trail)
      tableItem = bot.inventory.items().find((item) => item.name === 'crafting_table')
    }
    if (!tableItem) throw new Error('não consegui obter crafting_table')

    const anchor = this.storage?.getPosition?.() || bot.entity.position
    const offsets = [
      [2, 0], [-2, 0], [0, 2], [0, -2],
      [2, 1], [-2, 1], [1, 2], [1, -2]
    ]

    for (const [dx, dz] of offsets) {
      const target = new Vec3(Math.floor(anchor.x + dx), Math.floor(anchor.y), Math.floor(anchor.z + dz))
      const current = bot.blockAt(target)
      const below = bot.blockAt(target.offset(0, -1, 0))
      if (!below || below.name === 'air' || below.boundingBox === 'empty') continue
      if (current && current.name !== 'air' && current.boundingBox !== 'empty') continue

      await bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 3)).catch(() => {})
      await bot.equip(tableItem, 'hand')
      await bot.placeBlock(below, new Vec3(0, 1, 0))
      await bot.waitForTicks?.(2)
      table = bot.blockAt(target)
      if (table?.name === 'crafting_table') return table
    }

    throw new Error('não encontrei local livre para posicionar crafting_table')
  }

  itemById(bot, id) {
    return bot.registry?.items?.[id] ||
      bot.registry?.itemsArray?.find((item) => item.id === id) ||
      null
  }

  inventoryCount(bot, id, metadata = null) {
    return bot.inventory.items()
      .filter((item) => item.type === id && (metadata == null || item.metadata === metadata))
      .reduce((sum, item) => sum + item.count, 0)
  }

  async ensureIngredient(bot, id, metadata, count, depth, trail) {
    let have = this.inventoryCount(bot, id, metadata)
    if (have >= count) return

    const item = this.itemById(bot, id)
    if (!item) throw new Error(`item id ${id} desconhecido`)

    if (this.storage?.configured()) {
      await this.storage.withdraw(bot, item.name, count - have)
      have = this.inventoryCount(bot, id, metadata)
      if (have >= count) return
    }

    await this.craftInternal(bot, item.name, count - have, depth + 1, trail)
    have = this.inventoryCount(bot, id, metadata)
    if (have < count) throw new Error(`faltam ${item.name} x${count - have}`)
  }

  async craftInternal(bot, rawItemName, count = 1, depth = 0, trail = new Set()) {
    if (depth > 5) throw new Error('cadeia de crafting profunda demais')
    const itemName = normalizeItemName(rawItemName)
    if (trail.has(itemName)) throw new Error(`ciclo de crafting em ${itemName}`)

    const target = bot.registry?.itemsByName?.[itemName]
    if (!target) throw new Error(`item desconhecido: ${rawItemName}`)

    const table = this.findCraftingTable(bot)
    const recipes = bot.recipesAll(target.id, null, table || true)
    if (!recipes.length) throw new Error(`não encontrei receita para ${itemName}`)

    const nextTrail = new Set(trail)
    nextTrail.add(itemName)
    let lastError = null

    for (const recipe of recipes) {
      const runs = Math.ceil(count / Math.max(1, recipe.result?.count || 1))
      try {
        for (const ingredient of recipeIngredients(recipe, runs)) {
          await this.ensureIngredient(bot, ingredient.id, ingredient.metadata, ingredient.count, depth, nextTrail)
        }

        let craftingTable = null
        if (recipe.requiresTable) {
          craftingTable = await this.ensureCraftingTable(bot, depth, nextTrail)
          if (bot.entity.position.distanceTo(craftingTable.position) > 4) {
            await bot.pathfinder.goto(new goals.GoalNear(
              craftingTable.position.x,
              craftingTable.position.y,
              craftingTable.position.z,
              3
            ))
          }
        }

        await bot.craft(recipe, runs, craftingTable)
        return {
          item: itemName,
          requested: count,
          produced: runs * Math.max(1, recipe.result?.count || 1),
          runs
        }
      } catch (err) {
        lastError = err
      }
    }

    throw lastError || new Error(`não consegui fabricar ${itemName}`)
  }

  async craftToStorage(bot, itemName, count = 1) {
    const result = await this.craftInternal(bot, itemName, Math.max(1, Number(count) || 1))
    const normalized = normalizeItemName(itemName)
    if (this.storage?.configured()) {
      const deposited = await this.storage.deposit(bot, normalized, result.produced)
      result.deposited = deposited
    }
    return result
  }
}

module.exports = { ProductionManager, normalizeItemName, recipeIngredients, ITEM_ALIASES }
