const { goals: pathGoals } = require('mineflayer-pathfinder')
const craft = require('./craft')
const food = require('./food')
const { mineBlocks, hasPickaxe } = require('./gather')
const { bestTier, availableToolTiers } = require('./equipment')

const RETRY_MS = 5 * 60 * 1000   // espera máxima de uma meta que falha
const FIRST_RETRY_MS = 30 * 1000 // primeira espera; dobra a cada falha seguida
const MINE_BATCH = 6
// Estoques mínimos que o modo autônomo mantém. Sessão real de 30 min: sem eles
// o bot ficava no subsolo sem madeira (não fazia picareta de ferro com 11
// lingotes) e sem comida (fome 6, comendo carne podre).
const WOOD_STOCK = 8   // em tábuas: tronco = 4, tábua = 1, graveto = 1/2
const FOOD_STOCK = 4   // itens de comida no inventário
const WOOD_SEARCH_LEGS = 4
const WANDER_DISTANCE = 40
const isLog = (name) => /_log$/.test(name) && !name.startsWith('stripped_')

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

function woodUnits(bot) {
  let units = 0
  for (const item of bot.inventory.items()) {
    if (isLog(item.name)) units += item.count * 4
    else if (item.name.endsWith('_planks')) units += item.count
    else if (item.name === 'stick') units += item.count / 2
  }
  return units
}

function foodCount(bot) {
  return food.foodItems(bot).reduce((sum, item) => sum + item.count, 0)
}

// Céu à vista na altura da cabeça (a luz do céu não depende da hora).
function underground(bot) {
  const pos = bot.entity?.position
  if (!pos) return false
  const sky = bot.blockAt?.(pos.offset(0, 1, 0))?.skyLight
  return Number.isFinite(sky) ? sky < 8 : false
}

// Volta ao último ponto de superfície visto (cavando se precisar); sem um,
// sobe até o nível do mar.
async function toSurface(bot, surface, isCancelled) {
  if (!underground(bot)) return true
  const pos = bot.entity.position
  const goal = surface
    ? new pathGoals.GoalNear(surface.x, surface.y, surface.z, 2)
    : new pathGoals.GoalY(Math.max(63, Math.floor(pos.y) + 8))
  const distance = surface ? pos.distanceTo(surface) : 40
  await food.goTo(bot, goal, Math.max(30000, distance * 1500)).catch(() => {})
  return !isCancelled() && !underground(bot)
}

async function wander(bot, isCancelled) {
  const angle = Math.random() * 2 * Math.PI
  const pos = bot.entity.position
  const goal = new pathGoals.GoalXZ(Math.round(pos.x + Math.cos(angle) * WANDER_DISTANCE), Math.round(pos.z + Math.sin(angle) * WANDER_DISTANCE))
  await food.goTo(bot, goal, 60000).catch(() => {})
  return !isCancelled()
}

function buildGoals(bot, { surface = () => null } = {}) {
  const gear = ironGear(bot)
  const ironStillNeeded = () => gear.filter((g) => !g.done(bot)).reduce((sum, g) => sum + g.iron, 0)
  return [
    {
      name: 'estoque de comida',
      done: () => foodCount(bot) >= FOOD_STOCK,
      run: async (_bot, isCancelled) => {
        // Animais e plantações ficam na superfície.
        await toSurface(bot, surface(), isCancelled)
        if (isCancelled()) return null
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
    {
      // Toda receita precisa de graveto ou tábua; no subsolo não há árvore.
      name: 'madeira',
      done: () => woodUnits(bot) >= WOOD_STOCK,
      run: async (_bot, isCancelled) => {
        if (!(await toSurface(bot, surface(), isCancelled)) && !isCancelled()) throw new Error('não consegui voltar à superfície')
        for (let leg = 0; leg < WOOD_SEARCH_LEGS && !isCancelled(); leg++) {
          const got = await mineBlocks(bot, isLog, 3, isCancelled)
          if (got) return `cortei ${got} troncos`
          if (!(await wander(bot, isCancelled))) return null
        }
        if (!isCancelled()) throw new Error('não achei árvores')
        return null
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
    this.lastSurface = null   // último ponto com céu à vista, para voltar do subsolo
  }

  // Chamado pelo laço do companheiro: anota onde o bot viu o céu pela última vez.
  observe() {
    const pos = this.bot.entity?.position
    if (!pos || this.bot.entity.onGround === false || underground(this.bot)) return
    const sky = this.bot.blockAt?.(pos.offset(0, 1, 0))?.skyLight
    if (Number.isFinite(sky)) this.lastSurface = pos.floored()
  }

  goals() {
    return buildGoals(this.bot, { surface: () => this.lastSurface })
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

module.exports = { Autonomy, buildGoals, hasTier, woodUnits, underground, RETRY_MS, FIRST_RETRY_MS, WOOD_STOCK, FOOD_STOCK }
