function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

class MinecraftKnowledge {
  constructor(bot) {
    this.bot = bot
  }

  find(query, limit = 8) {
    const name = normalizeName(query)
    const items = this.bot.registry?.itemsByName || {}
    const blocks = this.bot.registry?.blocksByName || {}

    if (items[name] || blocks[name]) {
      return [{
        name,
        item: items[name] || null,
        block: blocks[name] || null,
        exact: true
      }]
    }

    const names = new Set([...Object.keys(items), ...Object.keys(blocks)])
    return [...names]
      .filter((candidate) => candidate.includes(name))
      .slice(0, limit)
      .map((candidate) => ({
        name: candidate,
        item: items[candidate] || null,
        block: blocks[candidate] || null,
        exact: false
      }))
  }

  resolve(query) {
    return this.find(query, 1)[0] || null
  }

  describe(query) {
    const result = this.resolve(query)
    if (!result) return null

    const food = this.bot.registry?.foodsByName?.[result.name]
    return {
      name: result.name,
      isItem: Boolean(result.item),
      isBlock: Boolean(result.block),
      stackSize: result.item?.stackSize ?? null,
      foodPoints: food?.foodPoints ?? null,
      saturation: food?.saturation ?? null,
      exact: result.exact
    }
  }

  recipesFor(query) {
    const result = this.resolve(query)
    const item = result?.item
    if (!item || typeof this.bot.recipesAll !== 'function') return []
    try {
      return this.bot.recipesAll(item.id, null, 1, null) || []
    } catch {
      return []
    }
  }

  itemNameFromId(id) {
    return this.bot.registry?.items?.[id]?.name ||
      this.bot.registry?.itemsArray?.find((item) => item.id === id)?.name ||
      `item_${id}`
  }
}

module.exports = { MinecraftKnowledge, normalizeName }
