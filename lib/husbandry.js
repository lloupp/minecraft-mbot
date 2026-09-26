const { goals } = require('mineflayer-pathfinder')
const food = require('./food')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// No 1.20.1 o metadado 'baby' dos Ageable fica no índice 16 (minecraft-data
// entities.metadataKeys); lê do registry quando houver, para não depender do número.
const BABY_METADATA_INDEX = 16
// Flags dos AbstractHorse (lhamas): 0x02 = domado. Lhama selvagem não entra no cio.
const HORSE_FLAGS_INDEX = 17
const HORSE_TAMED = 0x02
// Depois de procriar o adulto fica 5 min sem aceitar comida para cruzar.
const FEED_COOLDOWN_MS = 5 * 60 * 1000
const APPROACH_TIMEOUT_MS = 10000

// bot -> Map(id da entidade -> última vez que foi alimentada)
const lastFed = new WeakMap()

const SPECIES = {
  cow: { aliases: ['cow', 'vaca', 'vacas'], feed: ['wheat'] },
  sheep: { aliases: ['sheep', 'ovelha', 'ovelhas'], feed: ['wheat'] },
  pig: { aliases: ['pig', 'porco', 'porcos'], feed: ['carrot', 'potato', 'beetroot'] },
  chicken: { aliases: ['chicken', 'galinha', 'galinhas'], feed: ['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds'] },
  rabbit: { aliases: ['rabbit', 'coelho', 'coelhos'], feed: ['carrot', 'golden_carrot', 'dandelion'] },
  goat: { aliases: ['goat', 'cabra', 'cabras'], feed: ['wheat'] },
  mooshroom: { aliases: ['mooshroom', 'coguvaca', 'coguvacas'], feed: ['wheat'] },
  llama: { aliases: ['llama', 'lhama', 'lhamas'], feed: ['hay_block'] }
}

const ALIASES = new Map()
for (const [name, config] of Object.entries(SPECIES)) {
  for (const alias of config.aliases) ALIASES.set(alias, name)
}

function normalizeSpecies(value) {
  return ALIASES.get(String(value || '').toLowerCase()) || null
}

function metadataIndex(bot, entity, key, fallback) {
  const keys = bot.registry?.entitiesByName?.[entity.name]?.metadataKeys
  const index = Array.isArray(keys) ? keys.indexOf(key) : -1
  return index >= 0 ? index : fallback
}

function isBaby(bot, entity) {
  return entity?.metadata?.[metadataIndex(bot, entity, 'baby', BABY_METADATA_INDEX)] === true
}

function isTamed(bot, entity) {
  const flags = Number(entity?.metadata?.[metadataIndex(bot, entity, 'flags', HORSE_FLAGS_INDEX)]) || 0
  return (flags & HORSE_TAMED) !== 0
}

function fedRecently(bot, entity, now = Date.now()) {
  const at = lastFed.get(bot)?.get(entity.id)
  return typeof at === 'number' && now - at < FEED_COOLDOWN_MS
}

function markFed(bot, entity, now = Date.now()) {
  if (!lastFed.has(bot)) lastFed.set(bot, new Map())
  lastFed.get(bot).set(entity.id, now)
}

// Pode receber comida para procriar agora: adulto, fora do cooldown e,
// no caso da lhama, domado.
function canBreed(bot, entity, now = Date.now()) {
  if (isBaby(bot, entity)) return false
  if (entity.name === 'llama' && !isTamed(bot, entity)) return false
  return !fedRecently(bot, entity, now)
}

function selectAnimals(bot, species = null, {
  range = 24,
  center = bot.entity?.position,
  filter = null
} = {}) {
  const canonical = species ? normalizeSpecies(species) || species : null
  const max = Math.max(4, Math.min(64, Number(range) || 24))
  return Object.values(bot.entities || {})
    .filter((entity) =>
      entity &&
      entity !== bot.entity &&
      entity.isValid !== false &&
      SPECIES[entity.name] &&
      (!canonical || entity.name === canonical) &&
      entity.position &&
      center &&
      entity.position.distanceTo(center) <= max &&
      (!filter || filter(entity))
    )
    .sort((a, b) =>
      a.position.distanceTo(center) - b.position.distanceTo(center)
    )
}

function nearbyAnimals(bot, species = null, range = 24) {
  return selectAnimals(bot, species, { range })
}

function counts(bot, range = 24) {
  const out = {}
  for (const entity of nearbyAnimals(bot, null, range)) {
    out[entity.name] = (out[entity.name] || 0) + 1
  }
  return out
}

function inventoryItem(bot, names, minimum = 1) {
  const all = bot.inventory.items()
  for (const name of names) {
    const enough = all.find((item) => item.name === name && (item.count || 0) >= minimum)
    if (enough) return enough
  }
  return all
    .filter((item) => names.includes(item.name))
    .sort((a, b) => (b.count || 0) - (a.count || 0))[0] || null
}

async function withdrawFirst(bot, storage, names, count) {
  if (!storage?.configured?.()) return null
  for (const name of names) {
    const amount = await storage.withdraw(bot, name, count).catch(() => 0)
    if (amount > 0) return inventoryItem(bot, [name])
  }
  return null
}

async function ensureFeed(bot, config, count, storage) {
  let item = inventoryItem(bot, config.feed, count)
  if (item?.count >= count) return item

  if (storage?.configured?.()) {
    const missing = Math.max(1, count - (item?.count || 0))
    await withdrawFirst(bot, storage, config.feed, missing)
    item = inventoryItem(bot, config.feed, count)
  }
  return item
}

async function approach(bot, entity, distance = 2) {
  if (!entity?.position) throw new Error('animal sem posição')
  // Com timeout: animal cercado/inalcançável não pode travar o manejo.
  await food.goTo(
    bot,
    new goals.GoalNear(
      Math.floor(entity.position.x),
      Math.floor(entity.position.y),
      Math.floor(entity.position.z),
      distance
    ),
    APPROACH_TIMEOUT_MS
  )
}

async function breed(bot, species, pairs = 1, isCancelled = () => false, {
  storage = null,
  center = null,
  range = 32,
  filter = null
} = {}) {
  const canonical = normalizeSpecies(species)
  if (!canonical) throw new Error(`animal não suportado: ${species}`)
  const config = SPECIES[canonical]
  const requestedPairs = Math.max(1, Math.min(16, Number.parseInt(pairs, 10) || 1))
  const animals = selectAnimals(bot, canonical, {
    range,
    center: center || bot.entity?.position,
    filter
  })
  // Filhotes, recém-alimentados e lhamas selvagens não procriam: nem gastam ração.
  const breedable = animals.filter((entity) => canBreed(bot, entity))
  const neededAnimals = requestedPairs * 2

  if (breedable.length < 2) {
    return { ok: false, species: canonical, nearby: animals.length, adults: breedable.length, fed: 0, pairsAttempted: 0, reason: 'poucos_animais' }
  }

  // Número par: um animal sem par só desperdiça ração.
  const targets = breedable.slice(0, Math.min(neededAnimals, breedable.length - (breedable.length % 2)))
  const feed = await ensureFeed(bot, config, targets.length, storage)
  if (!feed) {
    return {
      ok: false,
      species: canonical,
      nearby: animals.length,
      fed: 0,
      pairsAttempted: 0,
      reason: 'sem_alimento',
      feed: config.feed
    }
  }

  let fed = 0
  for (const entity of targets) {
    if (isCancelled()) break
    if (entity.isValid === false) continue
    const currentFeed = inventoryItem(bot, [feed.name])
    if (!currentFeed) break

    await approach(bot, entity).catch(() => {})
    if (isCancelled()) break
    if (entity.position.distanceTo(bot.entity.position) > 4) continue

    await bot.equip(currentFeed, 'hand')
    await bot.activateEntity(entity)
    markFed(bot, entity)
    fed++
    await sleep(350)
  }

  return {
    ok: fed >= 2,
    species: canonical,
    nearby: animals.length,
    adults: breedable.length,
    fed,
    pairsAttempted: Math.floor(fed / 2),
    requestedPairs,
    feed: feed.name
  }
}

function populationPlan(current, target, availableAdults = current) {
  const now = Math.max(0, Number.parseInt(current, 10) || 0)
  const wanted = Math.max(2, Math.min(32, Number.parseInt(target, 10) || 2))
  const adults = Math.max(0, Number.parseInt(availableAdults, 10) || 0)
  if (now >= wanted) {
    return { current: now, target: wanted, deficit: 0, pairs: 0 }
  }
  const deficit = wanted - now
  const pairs = Math.max(0, Math.min(deficit, Math.floor(adults / 2), 16))
  return { current: now, target: wanted, deficit, pairs }
}

async function managePopulation(bot, species, target = 6, isCancelled = () => false, options = {}) {
  const canonical = normalizeSpecies(species)
  if (!canonical) throw new Error(`animal não suportado: ${species}`)
  const animals = selectAnimals(bot, canonical, {
    range: options.range || 32,
    center: options.center || bot.entity?.position,
    filter: options.filter || null
  })
  // Filhotes contam na população, mas só adultos aptos formam pares.
  const breedable = animals.filter((entity) => canBreed(bot, entity))
  const plan = populationPlan(animals.length, target, breedable.length)
  if (plan.deficit === 0) {
    return { ok: true, species: canonical, ...plan, action: 'nenhuma' }
  }
  if (plan.pairs === 0) {
    return { ok: false, species: canonical, ...plan, action: 'aguardar', reason: 'poucos_animais' }
  }

  const result = await breed(bot, canonical, plan.pairs, isCancelled, {
    ...options,
    center: options.center || bot.entity?.position,
    range: options.range || 32,
    filter: options.filter || null
  })
  return {
    ...result,
    current: plan.current,
    target: plan.target,
    deficit: plan.deficit,
    plannedPairs: plan.pairs,
    action: 'reproduzir'
  }
}

async function ensureShears(bot, { storage = null, production = null } = {}) {
  let shears = inventoryItem(bot, ['shears'])
  if (shears) return shears

  if (storage?.configured?.()) {
    await storage.withdraw(bot, 'shears', 1).catch(() => 0)
    shears = inventoryItem(bot, ['shears'])
    if (shears) return shears
  }

  if (production) {
    await production.craftInternal(bot, 'shears', 1).catch(() => null)
    shears = inventoryItem(bot, ['shears'])
  }
  return shears
}

async function shearSheep(bot, count = 1, isCancelled = () => false, options = {}) {
  const requested = Math.max(1, Math.min(32, Number.parseInt(count, 10) || 1))
  const shears = await ensureShears(bot, options)
  if (!shears) return { ok: false, sheared: 0, requested, reason: 'sem_tesoura' }

  const sheep = nearbyAnimals(bot, 'sheep', 32)
  let sheared = 0
  for (const entity of sheep) {
    if (sheared >= requested || isCancelled()) break
    if (entity.isValid === false) continue

    await approach(bot, entity).catch(() => {})
    if (isCancelled()) break
    if (entity.position.distanceTo(bot.entity.position) > 4) continue

    const current = inventoryItem(bot, ['shears'])
    if (!current) break
    await bot.equip(current, 'hand')
    await bot.activateEntity(entity)
    sheared++
    await sleep(400)
    await food.collectDrops(bot, entity.position.clone(), isCancelled).catch(() => {})
  }

  if (options.storage?.configured?.() && sheared > 0) {
    await options.storage.depositCargo(bot).catch(() => ({}))
  }

  return { ok: sheared > 0, sheared, requested, nearby: sheep.length }
}

module.exports = {
  SPECIES,
  FEED_COOLDOWN_MS,
  normalizeSpecies,
  isBaby,
  isTamed,
  canBreed,
  markFed,
  ensureFeed,
  selectAnimals,
  nearbyAnimals,
  counts,
  breed,
  populationPlan,
  managePopulation,
  shearSheep,
  ensureShears
}
