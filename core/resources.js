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
  quartzo: ['nether_quartz_ore'],
  quartz: ['nether_quartz_ore'],
  quartzo_do_nether: ['nether_quartz_ore'],
  ouro_do_nether: ['nether_gold_ore'],
  nether_gold: ['nether_gold_ore'],
  detritos_ancestrais: ['ancient_debris'],
  detrito_ancestral: ['ancient_debris'],
  ancient_debris: ['ancient_debris'],
  netherita: ['ancient_debris'],
  netherite: ['ancient_debris'],
  ametista: ['amethyst_cluster'],
  amethyst: ['amethyst_cluster'],
  obsidiana: ['obsidian'],
  pedra: ['stone', 'deepslate'],
  stone: ['stone', 'deepslate']
}

// Famílias mineráveis da versão 1.20.1. Modpacks entram dinamicamente
// pela lista de blocos registrados, sem declarar minérios que não existem.
const MINERAL_FAMILIES = [
  'carvao', 'ferro', 'cobre', 'ouro', 'redstone', 'lapis',
  'diamante', 'esmeralda', 'ametista',
  'quartzo', 'ouro_do_nether', 'detritos_ancestrais'
]
const NETHER_FAMILIES = new Set(['quartzo', 'ouro_do_nether', 'detritos_ancestrais'])
const MINERAL_GROUP_NAMES = new Set(['minerais', 'minerios', 'todos_minerais', 'todos_minerios', 'ores', 'minerals'])

function isMineralGroup(value) {
  return MINERAL_GROUP_NAMES.has(normalizeWord(value))
}

function mineralResourcesFor(bot) {
  const dimension = String(bot?.game?.dimension?.name || bot?.game?.dimension || 'overworld').toLowerCase()
  const nether = dimension.includes('nether')
  const families = MINERAL_FAMILIES.filter(name =>
    NETHER_FAMILIES.has(name) === nether && resolveBlockNames(bot, name).length > 0)
  // Ores adicionais de modpacks Forge/Fabric. Não minerar todas as variantes
  // deepslate como famílias independentes quando a família vanilla existe.
  const covered = new Set(MINERAL_FAMILIES.flatMap(name => RESOURCE_ALIASES[name] || []))
  const blockNames = Object.keys(bot?.registry?.blocksByName || {})
  const extras = blockNames.filter(name =>
    !covered.has(name) && (name.endsWith('_ore') || name.startsWith('ore_')) &&
    (nether ? /nether|netherrack/.test(name) : !/nether|netherrack/.test(name)))
  return [...families, ...extras].sort()
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
    .filter((name) => name.endsWith('_log') || name === 'crimson_stem' || name === 'warped_stem')
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

module.exports = { RESOURCE_ALIASES, MINERAL_FAMILIES, normalizeWord, resolveBlockNames, isMineralGroup, mineralResourcesFor }
