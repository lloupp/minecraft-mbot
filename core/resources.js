const RESOURCE_ALIASES = {
  ferro: ['iron_ore', 'deepslate_iron_ore'],
  iron: ['iron_ore', 'deepslate_iron_ore'],
  carvao: ['coal_ore', 'deepslate_coal_ore'],
  coal: ['coal_ore', 'deepslate_coal_ore'],
  cobre: ['copper_ore', 'deepslate_copper_ore'],
  copper: ['copper_ore', 'deepslate_copper_ore'],
  ouro: ['gold_ore', 'deepslate_gold_ore'],
  gold: ['gold_ore', 'deepslate_gold_ore'],
  diamante: ['diamond_ore', 'deepslate_diamond_ore'],
  diamond: ['diamond_ore', 'deepslate_diamond_ore'],
  redstone: ['redstone_ore', 'deepslate_redstone_ore'],
  lapis: ['lapis_ore', 'deepslate_lapis_ore'],
  esmeralda: ['emerald_ore', 'deepslate_emerald_ore'],
  emerald: ['emerald_ore', 'deepslate_emerald_ore'],
  pedra: ['stone', 'deepslate'],
  stone: ['stone', 'deepslate']
}

function normalizeWord(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_')
}

function logNames(bot) {
  return (bot.registry?.blocksArray || [])
    .map((block) => block.name)
    .filter((name) => name.endsWith('_log') || name.endsWith('_stem'))
}

function resolveBlockNames(bot, resource, role = null) {
  const normalized = normalizeWord(resource)
  if (!normalized) return []

  if (['madeira', 'madeiras', 'tronco', 'troncos', 'wood', 'log', 'logs'].includes(normalized)) {
    return logNames(bot)
  }

  const aliases = RESOURCE_ALIASES[normalized]
  if (aliases) return aliases.filter((name) => bot.registry?.blocksByName?.[name])

  if (role === 'lenhador') {
    const exactLog = logNames(bot).find((name) => name === normalized || name.includes(normalized))
    if (exactLog) return [exactLog]
  }

  if (bot.registry?.blocksByName?.[normalized]) return [normalized]
  return []
}

module.exports = { RESOURCE_ALIASES, normalizeWord, resolveBlockNames }
