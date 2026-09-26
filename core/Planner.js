class Planner {
  constructor(bot, knowledge) {
    this.bot = bot
    this.knowledge = knowledge
  }

  inventoryCount(itemId) {
    return this.bot.inventory?.items?.()
      .filter((item) => item.type === itemId)
      .reduce((sum, item) => sum + item.count, 0) || 0
  }

  craftPlan(query, count = 1) {
    const target = this.knowledge.resolve(query)
    if (!target?.item) {
      return { ok: false, reason: 'item_desconhecido', query }
    }

    const recipes = this.knowledge.recipesFor(target.name)
    if (!recipes.length) {
      return {
        ok: true,
        target: target.name,
        count,
        craftable: false,
        reason: 'sem_receita_conhecida',
        alternatives: []
      }
    }

    const candidates = recipes.map((recipe) => {
      const missing = []
      const ingredients = []
      const outputCount = Math.max(1, recipe.result?.count || 1)
      const runs = Math.ceil(count / outputCount)
      for (const delta of recipe.delta || []) {
        if (delta.count >= 0) continue
        const needed = Math.abs(delta.count) * runs
        const have = this.inventoryCount(delta.id)
        const name = this.knowledge.itemNameFromId(delta.id)
        ingredients.push({ name, needed, have })
        if (have < needed) missing.push({ name, needed: needed - have })
      }
      return {
        recipe,
        ingredients,
        missing,
        runs,
        outputCount,
        score: missing.reduce((sum, entry) => sum + entry.needed, 0)
      }
    }).sort((a, b) => a.score - b.score)

    const best = candidates[0]
    return {
      ok: true,
      target: target.name,
      count,
      craftable: best.missing.length === 0,
      requiresTable: Boolean(best.recipe.requiresTable),
      runs: best.runs,
      outputCount: best.outputCount,
      ingredients: best.ingredients,
      missing: best.missing,
      alternatives: candidates.length
    }
  }
}

module.exports = { Planner }
