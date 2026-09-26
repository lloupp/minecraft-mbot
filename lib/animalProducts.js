const food = require('./food')
const husbandry = require('./husbandry')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const PRODUCT_ALIASES = {
  la: 'wool',
  lã: 'wool',
  wool: 'wool',
  leite: 'milk',
  milk: 'milk',
  ovos: 'eggs',
  ovo: 'eggs',
  eggs: 'eggs',
  egg: 'eggs'
}

function normalizeProduct(value) {
  return PRODUCT_ALIASES[String(value || '').toLowerCase()] || null
}

function inventoryCount(bot, predicate) {
  return (bot.inventory?.items?.() || [])
    .filter((item) => predicate(item.name))
    .reduce((sum, item) => sum + (item.count || 0), 0)
}

function woolCount(bot) {
  return inventoryCount(bot, (name) => name.endsWith('_wool'))
}

function itemCount(bot, name) {
  return inventoryCount(bot, (itemName) => itemName === name)
}

async function ensureBuckets(bot, count, { storage = null, production = null } = {}) {
  const wanted = Math.max(1, Math.min(16, Number.parseInt(count, 10) || 1))
  let have = itemCount(bot, 'bucket')
  if (have >= wanted) return have

  if (storage?.configured?.()) {
    await storage.withdraw(bot, 'bucket', wanted - have).catch(() => 0)
    have = itemCount(bot, 'bucket')
    if (have >= wanted) return have
  }

  if (production) {
    await production.craftInternal(bot, 'bucket', wanted - have).catch(() => null)
    have = itemCount(bot, 'bucket')
  }

  return have
}

async function waitForInventory(bot, predicate, expected, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const count = inventoryCount(bot, predicate)
    if (count >= expected) return count
    await sleep(100)
  }
  return inventoryCount(bot, predicate)
}

async function milkCows(bot, count = 1, isCancelled = () => false, options = {}) {
  const wanted = Math.max(1, Math.min(16, Number.parseInt(count, 10) || 1))
  const cows = husbandry.selectAnimals(bot, 'cow', {
    range: options.range || 16,
    center: options.center || bot.entity?.position,
    filter: (entity) =>
      !husbandry.isBaby(bot, entity) &&
      (!options.filter || options.filter(entity))
  })

  if (!cows.length) {
    return { ok: false, requested: wanted, produced: 0, reason: 'sem_vacas_adultas' }
  }

  const buckets = await ensureBuckets(bot, wanted, options)
  if (buckets <= 0) {
    return { ok: false, requested: wanted, produced: 0, reason: 'sem_baldes' }
  }

  const target = Math.min(wanted, buckets)
  const before = itemCount(bot, 'milk_bucket')
  let produced = 0

  for (let i = 0; i < target && !isCancelled(); i++) {
    const bucket = (bot.inventory.items() || []).find((item) => item.name === 'bucket')
    if (!bucket) break

    const cow = cows[i % cows.length]
    if (!cow || cow.isValid === false) continue

    await bot.equip(bucket, 'hand')
    await bot.activateEntity(cow)
    const observed = await waitForInventory(
      bot,
      (name) => name === 'milk_bucket',
      before + produced + 1
    )
    if (observed >= before + produced + 1) produced++
  }

  return {
    ok: produced > 0,
    requested: wanted,
    produced,
    cows: cows.length,
    reason: produced > 0 ? null : 'interacao_sem_leite'
  }
}

async function collectEggs(bot, center, isCancelled = () => false) {
  const before = itemCount(bot, 'egg')
  await food.collectDrops(bot, center, isCancelled).catch(() => {})
  const after = itemCount(bot, 'egg')
  const collected = Math.max(0, after - before)
  return {
    ok: collected > 0,
    collected,
    reason: collected > 0 ? null : 'sem_ovos_no_chao'
  }
}

module.exports = {
  PRODUCT_ALIASES,
  normalizeProduct,
  inventoryCount,
  woolCount,
  itemCount,
  ensureBuckets,
  milkCows,
  collectEggs
}
