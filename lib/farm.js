// lib/farm.js
// Plantar e colher trigo, e transformar em pão. O trigo só amadurece com o
// tempo do mundo, então o fluxo é: conseguir sementes, arar, plantar, esperar
// (com teto), colher o que estiver maduro e replantar.

const { Vec3 } = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const { collectDrops } = require('./food')

const SEED = 'wheat_seeds'
const CROP = 'wheat'
const RIPE_AGE = 7
const WHEAT_PER_BREAD = 3
const GRASS = ['short_grass', 'grass', 'tall_grass', 'fern', 'large_fern']
const TILLABLE = ['dirt', 'grass_block', 'dirt_path', 'coarse_dirt', 'rooted_dirt']

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const countItem = (bot, name) => bot.inventory.items()
  .filter((item) => item.name === name)
  .reduce((sum, item) => sum + item.count, 0)

const isTillable = (name) => TILLABLE.includes(name)
const wheatNeededFor = (breads) => Math.max(1, Number(breads) || 1) * WHEAT_PER_BREAD

async function goTo(bot, position, range = 3, ms = 15000) {
  const goal = new goals.GoalNear(position.x, position.y, position.z, range)
  const timeout = new Promise((resolve) => setTimeout(() => resolve('tarde'), ms))
  const moved = await Promise.race([bot.pathfinder.goto(goal).then(() => 'ok', () => 'falhou'), timeout])
  if (moved === 'tarde') bot.pathfinder.setGoal?.(null)
  return moved === 'ok'
}

// Enxada: usa a que existe, senão fabrica (madeira antes de pedra).
async function ensureHoe(bot, { craftItem, log = () => {} } = {}) {
  const held = () => bot.inventory.items().find((item) => item.name.endsWith('_hoe')) || null
  if (held()) return held()
  if (typeof craftItem !== 'function') return null
  for (const name of ['wooden_hoe', 'stone_hoe']) {
    try {
      await craftItem(bot, name, 1, () => false)
    } catch (err) {
      log(`[trigo] enxada ${name}: ${err.message}`)
    }
    if (held()) return held()
  }
  return null
}

// Capim é quebrado direto: a checagem de drops do gather descarta esses blocos
// (a semente cai por probabilidade e não está na tabela de drops), então
// `mineBlocks` devolvia 0 mesmo com capim ao redor.
async function breakGrassForSeeds(bot, isCancelled = () => false, {
  attempts = 24, radius = 32, log = () => {}, drops = collectDrops
} = {}) {
  const ids = GRASS.map((name) => bot.registry.blocksByName?.[name]?.id).filter((id) => Number.isInteger(id))
  if (!ids.length) return { broken: 0, found: 0 }
  const positions = bot.findBlocks({ matching: ids, maxDistance: radius, count: attempts })
  let broken = 0
  for (const pos of positions) {
    if (isCancelled()) break
    const block = bot.blockAt(pos)
    if (!block || !GRASS.includes(block.name)) continue
    await goTo(bot, pos, 2).catch(() => {})
    try {
      await bot.dig(block)
      broken++
    } catch (err) {
      log(`[trigo] capim em ${pos.x},${pos.y},${pos.z}: ${err.message}`)
      continue
    }
    await drops(bot, new Vec3(pos.x, pos.y, pos.z), isCancelled, { radius: 3 }).catch(() => {})
  }
  return { broken, found: positions.length }
}

// Sementes: quebrar capim é a fonte barata (cada bloco pode soltar sementes).
async function collectSeeds(bot, wanted, isCancelled, {
  breakBlocks = null, maxBlocks = 128, rounds = 6, move = null, log = () => {}
} = {}) {
  const have = () => countItem(bot, SEED)
  if (have() >= wanted) return { ok: true, seeds: have(), blocks: 0, rounds: 0 }
  let blocks = 0
  let walked = 0
  for (let round = 0; round < rounds && have() < wanted && blocks < maxBlocks && !isCancelled(); round++) {
    const breaker = breakBlocks || (() => breakGrassForSeeds(bot, isCancelled, { log }))
    const out = await breaker().catch(() => null)
    const got = typeof out === 'number' ? out : (out?.broken || 0)
    if (got) {
      blocks += got
      log(`[trigo] capim quebrado: ${blocks} (sementes ${have()}/${wanted})`)
      continue
    }
    // Sem capim por perto: anda um pouco e tenta de novo em vez de desistir.
    if (!move || isCancelled()) break
    walked++
    log(`[trigo] sem capim aqui; procurando em outro lugar (${walked})`)
    await move(walked).catch(() => {})
  }
  return { ok: have() >= wanted, seeds: have(), blocks, rounds: walked }
}

// Ara e planta até `plots` canteiros perto de `center`.
async function plantArea(bot, { center, plots = 9, radius = 8, hoe = null, isCancelled = () => false, log = () => {} } = {}) {
  const ids = TILLABLE.map((name) => bot.registry.blocksByName[name]?.id).filter((id) => Number.isInteger(id))
  if (!ids.length) return { ok: false, tilled: 0, planted: 0, reason: 'sem blocos aráveis no registro' }
  const point = new Vec3(Math.floor(center.x), Math.floor(center.y), Math.floor(center.z))
  const candidates = bot.findBlocks({ matching: ids, maxDistance: radius, count: plots * 4, point })
  let tilled = 0
  let planted = 0
  for (const pos of candidates) {
    if (planted >= plots || isCancelled()) break
    const above = bot.blockAt(pos.offset(0, 1, 0))
    if (!above || above.boundingBox !== 'empty') continue
    const block = bot.blockAt(pos)
    if (!block || !isTillable(block.name)) continue
    await goTo(bot, pos)
    if (isCancelled()) break
    if (hoe) await bot.equip(hoe, 'hand').catch(() => {})
    await bot.activateBlock(block.clone ? block.clone() : block, new Vec3(0, 1, 0)).catch(() => {})
    await sleep(180)
    const farmland = bot.blockAt(pos)
    if (farmland?.name !== 'farmland') continue
    tilled++
    const seed = bot.inventory.items().find((item) => item.name === SEED)
    if (!seed) continue
    await bot.equip(seed, 'hand').catch(() => {})
    try {
      await bot.placeBlock(farmland, new Vec3(0, 1, 0))
      planted++
    } catch (err) {
      log(`[trigo] plantar em ${pos}: ${err.message}`)
    }
  }
  return { ok: planted > 0, tilled, planted }
}

// Colhe só o trigo maduro (age 7) e recolhe os drops; o resto fica crescendo.
async function harvestRipe(bot, isCancelled = () => false, { radius = 32, log = () => {} } = {}) {
  const id = bot.registry.blocksByName[CROP]?.id
  if (!Number.isInteger(id)) return { harvested: 0, ripe: 0 }
  const positions = bot.findBlocks({ matching: id, maxDistance: radius, count: 64 })
  let ripe = 0
  let harvested = 0
  for (const pos of positions) {
    if (isCancelled()) break
    const block = bot.blockAt(pos)
    if (!block || block.name !== CROP) continue
    const age = Number(block.getProperties?.().age ?? 0)
    if (!Number.isFinite(age) || age < RIPE_AGE) continue
    ripe++
    await goTo(bot, pos)
    if (isCancelled()) break
    try {
      await bot.dig(block)
      harvested++
      await collectDrops(bot, new Vec3(pos.x, pos.y, pos.z), isCancelled, { radius: 4 })
    } catch (err) {
      log(`[trigo] colher em ${pos}: ${err.message}`)
    }
  }
  return { harvested, ripe }
}

// Quantos pés de trigo existem por perto (plantados ou crescendo).
function countCrops(bot, { radius = 32 } = {}) {
  const id = bot.registry?.blocksByName?.[CROP]?.id
  if (!Number.isInteger(id)) return 0
  return bot.findBlocks({ matching: id, maxDistance: radius, count: 64 })
    .filter((pos) => bot.blockAt(pos)?.name === CROP).length
}

// Espera trigo maduro aparecer, com teto de tempo.
async function waitRipe(bot, { minutes = 20, isCancelled = () => false, onTick = () => {}, sleepMs = 15000 } = {}) {
  const id = bot.registry.blocksByName[CROP]?.id
  const ripeCount = () => {
    if (!Number.isInteger(id)) return 0
    return bot.findBlocks({ matching: id, maxDistance: 32, count: 64 })
      .filter((pos) => Number(bot.blockAt(pos)?.getProperties?.().age ?? 0) >= RIPE_AGE).length
  }
  const deadline = Date.now() + minutes * 60000
  while (Date.now() < deadline && !isCancelled()) {
    const ripe = ripeCount()
    if (ripe > 0) return { ok: true, ripe }
    onTick(ripe)
    await sleep(sleepMs)
  }
  return { ok: false, ripe: ripeCount() }
}

module.exports = {
  ensureHoe, collectSeeds, breakGrassForSeeds, plantArea, harvestRipe, waitRipe, countCrops,
  wheatNeededFor, countItem, isTillable, goTo,
  SEED, CROP, RIPE_AGE, WHEAT_PER_BREAD, GRASS, TILLABLE
}
