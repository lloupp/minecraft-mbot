// lib/autonomy.js
// Modo autônomo sem IA: uma lista de metas na ordem em que um jogador progride
// (madeira → pedra → ferro). A cada ciclo o bot executa a primeira meta ainda
// não cumprida; metas que falham ficam em espera antes de tentar de novo.

const craft = require('./craft')
const food = require('./food')
const { mineBlocks, hasPickaxe } = require('./gather')
const { TOOL_TIERS } = require('./equipment')

const RETRY_MS = 5 * 60 * 1000
const MINE_BATCH = 6

const count = (bot, name) => {
  const item = bot.registry.itemsByName[name]
  return item ? craft.countItem(bot, item.id) : 0
}
const countAny = (bot, names) => names.reduce((sum, name) => sum + count(bot, name), 0)

// Melhor nível (índice em TOOL_TIERS, menor = melhor) de `kind` no inventário.
function bestTier(bot, kind) {
  const tiers = bot.inventory.items()
    .filter((i) => i.name.endsWith(`_${kind}`))
    .map((i) => TOOL_TIERS.findIndex((t) => i.name.startsWith(`${t.tier}_`)))
    .filter((t) => t >= 0)
  return tiers.length ? Math.min(...tiers) : Infinity
}
const tierIndex = (tier) => TOOL_TIERS.findIndex((t) => t.tier === tier)
const hasTier = (bot, kind, tier) => bestTier(bot, kind) <= tierIndex(tier)
const wearing = (bot, piece) => bot.inventory.slots.slice(5, 9).some((i) => i?.name === piece) || count(bot, piece) > 0

const IRON_GEAR = [
  { item: 'iron_pickaxe', iron: 3, done: (bot) => hasTier(bot, 'pickaxe', 'iron') },
  { item: 'iron_sword', iron: 2, done: (bot) => hasTier(bot, 'sword', 'iron') },
  { item: 'iron_chestplate', iron: 8, done: (bot) => wearing(bot, 'iron_chestplate') },
  { item: 'iron_leggings', iron: 7, done: (bot) => wearing(bot, 'iron_leggings') },
  { item: 'iron_helmet', iron: 5, done: (bot) => wearing(bot, 'iron_helmet') },
  { item: 'iron_boots', iron: 4, done: (bot) => wearing(bot, 'iron_boots') },
  { item: 'shield', iron: 1, done: (bot) => count(bot, 'shield') > 0 }
]
const ironStillNeeded = (bot) => IRON_GEAR.filter((g) => !g.done(bot)).reduce((sum, g) => sum + g.iron, 0)

const makeItem = (item, amount = 1) => async (bot, isCancelled) => {
  await craft.craftItem(bot, item, count(bot, item) + amount, isCancelled)
  return `fiz ${item}`
}

async function mineOre(bot, ores, amount, isCancelled) {
  const got = await mineBlocks(bot, (name) => ores.includes(name), amount, isCancelled)
  if (!got && !isCancelled()) throw new Error(`não achei ${ores[0]} por perto`)
  return got
}

// Metas em ordem de prioridade. `done` diz se já está cumprida; `run` executa um passo.
const GOALS = [
  {
    name: 'estoque de comida',
    done: (bot) => food.hasFood(bot) || bot.food >= 18,
    run: async (bot, isCancelled) => {
      const done = await food.gatherFood(bot, isCancelled)
      if (!done && !isCancelled()) throw new Error('não achei comida por perto')
      return done
    }
  },
  {
    name: 'cozinhar carne',
    done: (bot) => craft.rawFoods(bot).reduce((s, i) => s + i.count, 0) < 3,
    run: async (bot, isCancelled) => {
      const [raw] = craft.rawFoods(bot)
      const done = await craft.smeltItem(bot, raw.name, raw.count, isCancelled)
      return `cozinhei ${done}x ${raw.name}`
    }
  },
  { name: 'picareta de madeira', done: (bot) => hasPickaxe(bot), run: makeItem('wooden_pickaxe') },
  { name: 'picareta de pedra', done: (bot) => hasTier(bot, 'pickaxe', 'stone'), run: makeItem('stone_pickaxe') },
  { name: 'espada de pedra', done: (bot) => hasTier(bot, 'sword', 'stone'), run: makeItem('stone_sword') },
  { name: 'machado de pedra', done: (bot) => hasTier(bot, 'axe', 'stone'), run: makeItem('stone_axe') },
  { name: 'fornalha', done: (bot) => count(bot, 'furnace') > 0, run: makeItem('furnace') },
  {
    name: 'carvão',
    done: (bot) => countAny(bot, ['coal', 'charcoal']) >= 8 || count(bot, 'torch') >= 16,
    run: async (bot, isCancelled) => `minerei ${await mineOre(bot, ['coal_ore', 'deepslate_coal_ore'], MINE_BATCH, isCancelled)} carvão`
  },
  { name: 'tochas', done: (bot) => count(bot, 'torch') >= 16, run: makeItem('torch', 16) },
  {
    name: 'ferro',
    done: (bot) => count(bot, 'iron_ingot') >= Math.min(ironStillNeeded(bot), 8) || ironStillNeeded(bot) === 0,
    run: async (bot, isCancelled) => {
      if (count(bot, 'raw_iron') === 0) {
        await mineOre(bot, ['iron_ore', 'deepslate_iron_ore'], MINE_BATCH, isCancelled)
      }
      if (isCancelled()) return null
      const smelted = await craft.smeltItem(bot, 'raw_iron', count(bot, 'raw_iron'), isCancelled)
      return `fundi ${smelted} ferro`
    }
  },
  ...IRON_GEAR.map((g) => ({
    name: g.item,
    done: g.done,
    ready: (bot) => count(bot, 'iron_ingot') >= g.iron,
    run: makeItem(g.item)
  }))
]

class Autonomy {
  constructor(bot) {
    this.bot = bot
    this.blockedUntil = new Map() // meta -> quando pode tentar de novo
  }

  // Próxima meta a fazer (não cumprida, pronta e fora da espera), ou null.
  next() {
    const now = Date.now()
    return GOALS.find((goal) =>
      !goal.done(this.bot) &&
      (!goal.ready || goal.ready(this.bot)) &&
      (this.blockedUntil.get(goal.name) || 0) <= now) || null
  }

  failed(goal) {
    this.blockedUntil.set(goal.name, Date.now() + RETRY_MS)
  }

  // Resumo para o chat: metas cumpridas e a próxima.
  progress() {
    const done = GOALS.filter((g) => g.done(this.bot)).length
    const next = this.next()
    return `Metas: ${done}/${GOALS.length}${next ? ` | próxima: ${next.name}` : ''}`
  }
}

module.exports = { Autonomy, GOALS, bestTier }
