// lib/ore-mission.js
// Missão: juntar `target` de CADA minério. Conta pelo ITEM no inventário (o
// minério bruto/drop), não por blocos cavados, e retoma de onde parou porque o
// progresso é derivado da mochila.

const ORE_FAMILIES = [
  { key: 'carvao', label: 'carvão', item: 'coal', blocks: ['coal_ore', 'deepslate_coal_ore'], tool: 'stone' },
  { key: 'ferro', label: 'ferro', item: 'raw_iron', blocks: ['iron_ore', 'deepslate_iron_ore'], tool: 'stone' },
  { key: 'cobre', label: 'cobre', item: 'raw_copper', blocks: ['copper_ore', 'deepslate_copper_ore'], tool: 'stone' },
  { key: 'lapis', label: 'lápis', item: 'lapis_lazuli', blocks: ['lapis_ore', 'deepslate_lapis_ore'], tool: 'stone' },
  { key: 'ouro', label: 'ouro', item: 'raw_gold', blocks: ['gold_ore', 'deepslate_gold_ore'], tool: 'iron' },
  { key: 'redstone', label: 'redstone', item: 'redstone', blocks: ['redstone_ore', 'deepslate_redstone_ore'], tool: 'iron' },
  { key: 'diamante', label: 'diamante', item: 'diamond', blocks: ['diamond_ore', 'deepslate_diamond_ore'], tool: 'iron' },
  { key: 'esmeralda', label: 'esmeralda', item: 'emerald', blocks: ['emerald_ore', 'deepslate_emerald_ore'], tool: 'iron' }
]

const countItem = (bot, name) => bot.inventory.items()
  .filter((item) => item.name === name)
  .reduce((sum, item) => sum + item.count, 0)

function progressOf(bot, target) {
  const out = {}
  for (const family of ORE_FAMILIES) out[family.key] = Math.min(countItem(bot, family.item), target)
  return out
}

function complete(progress, target) {
  return ORE_FAMILIES.every((family) => (progress[family.key] || 0) >= target)
}

// Percorre as famílias; `mine(family, need, isCancelled)` faz o trabalho pesado.
async function mineMission(bot, {
  target = 64, isCancelled = () => false, mine, ensureTool = null, onProgress = () => {}
} = {}) {
  if (typeof mine !== 'function') throw new Error('mineMission precisa da função mine')
  const report = []
  for (const family of ORE_FAMILIES) {
    if (isCancelled()) return { ok: false, cancelled: true, progress: progressOf(bot, target), report }
    const have = countItem(bot, family.item)
    report.push({ key: family.key, item: family.item, have, target })
    if (have >= target) {
      onProgress(family, have)
      continue
    }
    if (ensureTool) {
      await ensureTool(family).catch(() => {})
      if (isCancelled()) return { ok: false, cancelled: true, progress: progressOf(bot, target), report }
    }
    await mine(family, target - have, isCancelled)
    const after = countItem(bot, family.item)
    report[report.length - 1].have = after
    onProgress(family, after)
  }
  const progress = progressOf(bot, target)
  return { ok: complete(progress, target), cancelled: false, progress, report }
}

module.exports = { ORE_FAMILIES, mineMission, progressOf, complete, countItem }
