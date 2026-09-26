const craft = require('./craft')
const food = require('./food')
const { mineBlocks, hasPickaxe } = require('./gather')
const { bestTier, availableToolTiers } = require('./equipment')

const RETRY_MS = 5 * 60 * 1000   // espera máxima de uma meta que falha
const FIRST_RETRY_MS = 30 * 1000 // primeira espera; dobra a cada falha seguida
const MINE_BATCH = 6

const count = (bot, name) => {
  const item = bot.registry?.itemsByName?.[name]
  return item ? craft.countItem(bot, item.id) : 0
}
const countAny = (bot, names) => names.reduce((sum, name) => sum + count(bot, name), 0)

function tierIndex(bot, kind, tier) {
  return availableToolTiers(bot, kind).findIndex((entry) => entry.tier === tier)
}

function hasTier(bot, kind, tier) {
  const wanted = tierIndex(bot, kind, tier)
  if (wanted < 0) return false
  return bestTier(bot, kind) <= wanted
}

const wearing = (bot, piece) =>
  bot.inventory.slots.slice(5, 9).some((item) => item?.name === piece) || count(bot, piece) > 0

function ironGear(bot) {
  const defs = [
    { item: 'iron_pickaxe', iron: 3, done: (b) => hasTier(b, 'pickaxe', 'iron') },
    { item: 'iron_sword', iron: 2, done: (b) => hasTier(b, 'sword', 'iron') },
    { item: 'iron_chestplate', iron: 8, done: (b) => wearing(b, 'iron_chestplate') },
    { item: 'iron_leggings', iron: 7, done: (b) => wearing(b, 'iron_leggings') },
    { item: 'iron_helmet', iron: 5, done: (b) => wearing(b, 'iron_helmet') },
    { item: 'iron_boots', iron: 4, done: (b) => wearing(b, 'iron_boots') },
    { item: 'shield', iron: 1, done: (b) => count(b, 'shield') > 0 }
  ]
  return defs.filter((entry) => Boolean(bot.registry?.itemsByName?.[entry.item]))
}

const makeItem = (item, amount = 1) => async (bot, isCancelled) => {
  await craft.craftItem(bot, item, count(bot, item) + amount, isCancelled)
  return `fiz ${item}`
}

async function mineOre(bot, ores, amount, isCancelled) {
  const available = ores.filter((name) => bot.registry?.blocksByName?.[name])
  if (!available.length) throw new Error('minério não existe nesta versão')
  const got = await mineBlocks(bot, (name) => available.includes(name), amount, isCancelled)
  if (!got && !isCancelled()) throw new Error(`não achei ${available[0]} por perto`)
  return got
}

function buildGoals(bot) {
  const gear = ironGear(bot)
  const ironStillNeeded = () => gear.filter((g) => !g.done(bot)).reduce((sum, g) => sum + g.iron, 0)
  return [
    {
      name: 'estoque de comida',
      done: () => food.hasFood(bot) || bot.food >= 18,
      run: async (_bot, isCancelled) => {
        const done = await food.gatherFood(bot, isCancelled)
        if (!done && !isCancelled()) throw new Error('não achei comida por perto')
        return done
      }
    },
    {
      name: 'cozinhar comida',
      done: () => craft.rawFoods(bot).reduce((sum, item) => sum + item.count, 0) < 3,
      run: async (_bot, isCancelled) => {
        const [raw] = craft.rawFoods(bot)
        const done = await craft.smeltItem(bot, raw.name, raw.count, isCancelled)
        return `cozinhei ${done}x ${raw.name}`
      }
    },
    { name: 'picareta de madeira', done: () => hasPickaxe(bot), run: makeItem('wooden_pickaxe') },
    { name: 'picareta de pedra', done: () => hasTier(bot, 'pickaxe', 'stone'), run: makeItem('stone_pickaxe') },
    { name: 'espada de pedra', done: () => hasTier(bot, 'sword', 'stone'), run: makeItem('stone_sword') },
    { name: 'machado de pedra', done: () => hasTier(bot, 'axe', 'stone'), run: makeItem('stone_axe') },
    { name: 'fornalha', done: () => count(bot, 'furnace') > 0, run: makeItem('furnace') },
    {
      name: 'carvão',
      done: () => countAny(bot, ['coal', 'charcoal']) >= 8 || count(bot, 'torch') >= 16,
      run: async (_bot, isCancelled) =>
        `minerei ${await mineOre(bot, ['coal_ore', 'deepslate_coal_ore'], MINE_BATCH, isCancelled)} carvão`
    },
    {
      name: 'tochas',
      done: () => count(bot, 'torch') >= 16,
      // Cada carvão rende 4 tochas; parte do carvão pode ter virado combustível.
      ready: () => countAny(bot, ['coal', 'charcoal']) > 0,
      run: (runBot, isCancelled) => makeItem('torch', Math.min(16 - count(bot, 'torch'), 4 * countAny(bot, ['coal', 'charcoal'])))(runBot, isCancelled)
    },
    {
      name: 'ferro',
      done: () => count(bot, 'iron_ingot') >= Math.min(ironStillNeeded(), 8) || ironStillNeeded() === 0,
      run: async (_bot, isCancelled) => {
        if (count(bot, 'raw_iron') === 0) {
          await mineOre(bot, ['iron_ore', 'deepslate_iron_ore'], MINE_BATCH, isCancelled)
        }
        if (isCancelled()) return null
        const smelted = await craft.smeltItem(bot, 'raw_iron', count(bot, 'raw_iron'), isCancelled)
        return `fundi ${smelted} ferro`
      }
    },
    ...gear.map((g) => ({
      name: g.item,
      done: () => g.done(bot),
      ready: () => count(bot, 'iron_ingot') >= g.iron,
      run: makeItem(g.item)
    }))
  ]
}

class Autonomy {
  constructor(bot) {
    this.bot = bot
    this.blockedUntil = new Map()
    this.failures = new Map() // falhas seguidas por meta
  }

  goals() {
    return buildGoals(this.bot)
  }

  next() {
    const now = Date.now()
    return this.goals().find((goal) =>
      !goal.done() &&
      (!goal.ready || goal.ready()) &&
      (this.blockedUntil.get(goal.name) || 0) <= now
    ) || null
  }

  succeeded(goal) {
    this.failures.delete(goal.name)
    this.blockedUntil.delete(goal.name)
  }

  // Espera crescente: 30s, 1min, 2min, 4min, 5min... Falhas logo após entrar no
  // mundo (terreno ainda carregando) não travam o bot por minutos.
  failed(goal) {
    const n = (this.failures.get(goal.name) || 0) + 1
    this.failures.set(goal.name, n)
    this.blockedUntil.set(goal.name, Date.now() + Math.min(RETRY_MS, FIRST_RETRY_MS * 2 ** (n - 1)))
  }

  progress() {
    const goals = this.goals()
    const done = goals.filter((goal) => goal.done()).length
    const next = this.next()
    return `Metas: ${done}/${goals.length}${next ? ` | próxima: ${next.name}` : ''}`
  }
}

module.exports = { Autonomy, buildGoals, hasTier, RETRY_MS, FIRST_RETRY_MS }
