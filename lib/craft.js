// lib/craft.js
// Fabricar itens (com mesa de trabalho quando a receita exige) e usar a fornalha
// para cozinhar comida e fundir minérios.

const { goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const { goTo } = require('./food')
const { mineBlocks, hasPickaxe } = require('./gather')

const STATION_RANGE = 24
const MAX_DEPTH = 5
const MAX_ROUNDS = 8 // coletas de matéria-prima por pedido de fabricação

// O minecraft-data não tem receitas de fornalha; tabela do que dá para cozinhar/fundir.
const SMELTS = {
  beef: 'cooked_beef',
  porkchop: 'cooked_porkchop',
  mutton: 'cooked_mutton',
  chicken: 'cooked_chicken',
  rabbit: 'cooked_rabbit',
  cod: 'cooked_cod',
  salmon: 'cooked_salmon',
  potato: 'baked_potato',
  kelp: 'dried_kelp',
  raw_iron: 'iron_ingot',
  raw_gold: 'gold_ingot',
  raw_copper: 'copper_ingot',
  iron_ore: 'iron_ingot',
  gold_ore: 'gold_ingot',
  copper_ore: 'copper_ingot',
  sand: 'glass',
  cobblestone: 'stone',
  clay_ball: 'brick'
}
const isLog = (name) => name.endsWith('_log') || name.endsWith('_stem')
const smeltResult = (name) => SMELTS[name] || (isLog(name) ? 'charcoal' : null)

// Itens que a fornalha consegue processar por unidade de combustível.
function fuelValue(name) {
  if (name === 'coal' || name === 'charcoal') return 8
  if (name === 'coal_block') return 80
  if (name.endsWith('_planks') || isLog(name)) return 1.5
  if (name === 'stick') return 0.5
  return 0
}

// Matéria-prima que o bot sabe coletar sozinho quando falta para uma receita.
const STONE_ITEMS = ['cobblestone', 'cobbled_deepslate', 'blackstone']
function rawSource(name) {
  if (isLog(name)) return { what: 'troncos', blocks: isLog, amount: (n) => n + 2 }
  if (STONE_ITEMS.includes(name)) {
    return { what: 'pedra', blocks: (b) => ['stone', 'cobblestone', 'deepslate'].includes(b), amount: (n) => n + 1, needsPickaxe: true }
  }
  return null
}

// Sinaliza que coletou material e o plano deve ser refeito do zero
// (com o material novo, outra variante de receita pode ser a melhor).
class Replan extends Error {
  constructor(reason = 'material mudou') { super(reason) }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const RAW_FOODS = ['beef', 'porkchop', 'mutton', 'chicken', 'rabbit', 'cod', 'salmon', 'potato']

function countItem(bot, id) {
  return bot.inventory.items().filter((i) => i.type === id).reduce((sum, i) => sum + i.count, 0)
}

const itemName = (bot, id) => bot.registry.items[id]?.name ?? `#${id}`

// Ingredientes consumidos por uma execução da receita: [{ id, count }].
function ingredients(recipe) {
  return recipe.delta.filter((d) => d.count < 0).map((d) => ({ id: d.id, count: -d.count }))
}

// Quanto falta de cada ingrediente para executar a receita `times` vezes.
function missingFor(bot, recipe, times) {
  return ingredients(recipe)
    .map(({ id, count }) => ({ id, count: count * times - countItem(bot, id) }))
    .filter((m) => m.count > 0)
}

// Lugares livres perto do bot para colocar um bloco (chão sólido, ar em cima),
// longe o bastante para o bloco não encostar no próprio bot.
function placeSpots(bot) {
  const base = bot.entity.position.floored()
  const spots = []
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (const dy of [0, 1, -1]) {
        const spot = base.offset(dx, dy, dz)
        const center = spot.offset(0.5, 0, 0.5)
        const dist = Math.hypot(center.x - bot.entity.position.x, center.z - bot.entity.position.z)
        if (dist < 1.5) continue
        const floor = bot.blockAt(spot.offset(0, -1, 0))
        if (floor?.boundingBox === 'block' && bot.blockAt(spot)?.name === 'air' && bot.blockAt(spot.offset(0, 1, 0))?.name === 'air') {
          spots.push({ floor, dist })
        }
      }
    }
  }
  return spots.sort((a, b) => a.dist - b.dist).map((s) => s.floor)
}

async function placeFromInventory(bot, name) {
  const blockId = bot.registry.blocksByName[name].id
  const placedNear = () => bot.findBlock({ matching: blockId, maxDistance: 4 })
  let lastError = new Error(`não achei lugar para colocar ${name}`)
  for (const floor of placeSpots(bot).slice(0, 5)) {
    const item = bot.inventory.items().find((i) => i.name === name)
    if (!item) return placedNear()
    try {
      await bot.equip(item, 'hand')
      if (bot.heldItem?.name !== name) throw new Error(`não consegui segurar ${name}`)
      await bot.placeBlock(floor, new Vec3(0, 1, 0))
    } catch (err) {
      lastError = err
    }
    // A confirmação pode atrasar: se o bloco já está lá, não tenta de novo.
    await sleep(600)
    const placed = placedNear()
    if (placed) return placed
  }
  throw lastError
}

// Acha uma estação (mesa/fornalha) por perto; senão coloca uma do inventário,
// fabricando-a se for preciso.
async function ensureStation(bot, name, isCancelled, depth) {
  const type = bot.registry.blocksByName[name]
  const near = bot.findBlock({ matching: type.id, maxDistance: STATION_RANGE })
  if (near) return near
  if (countItem(bot, bot.registry.itemsByName[name].id) === 0) {
    await craftItem(bot, name, 1, isCancelled)
  }
  if (isCancelled()) return null
  console.log(`Colocando ${name}`)
  return placeFromInventory(bot, name)
}

// Estimativa de quanto material bruto (sem receita) falta para ter `count` de `id`.
// Usada para escolher entre variantes de receita: prefere a que dá para fazer
// com o que já temos (ex.: tábuas de abeto se temos troncos de abeto).
function shortfall(bot, id, count, depth = 0) {
  const missing = count - countItem(bot, id)
  if (missing <= 0) return 0
  const recipes = depth < 3 ? bot.recipesAll(id, null, true) : []
  if (!recipes.length) return missing * 100
  let best = Infinity
  for (const recipe of recipes) {
    const times = Math.ceil(missing / recipe.result.count)
    let cost = 0
    for (const ing of ingredients(recipe)) {
      cost += shortfall(bot, ing.id, ing.count * times, depth + 1)
      if (cost >= best) break
    }
    best = Math.min(best, cost)
  }
  return best
}

// Escolhe a variante da receita (ex.: gravetos de qualquer madeira) mais viável.
function bestRecipe(bot, itemId, needed) {
  const recipes = bot.recipesAll(itemId, null, true)
  if (!recipes.length) return null
  return recipes
    .map((recipe) => {
      const times = Math.ceil(needed / recipe.result.count)
      const score = ingredients(recipe).reduce((sum, ing) => sum + shortfall(bot, ing.id, ing.count * times, 1), 0)
      return { recipe, missing: missingFor(bot, recipe, times), score: score + (recipe.requiresTable ? 0.5 : 0) }
    })
    .sort((a, b) => a.score - b.score)[0]
}

// Fabrica até ter `count` unidades de `name`, fabricando antes os ingredientes
// que faltarem e coletando a matéria-prima (madeira, pedra) quando precisa.
async function craftItem(bot, name, count, isCancelled) {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    try {
      return await craftStep(bot, name, count, isCancelled, 0)
    } catch (err) {
      if (!(err instanceof Replan)) throw err
      console.log(`Replanejando ${name}: ${err.message}`)
    }
    if (isCancelled()) return
  }
  throw new Error(`não consegui juntar material para ${name}`)
}

async function craftStep(bot, name, count, isCancelled, depth) {
  const item = bot.registry.itemsByName[name]
  if (!item) throw new Error(`não conheço o item "${name}"`)
  const needed = count - countItem(bot, item.id)
  if (needed <= 0) return
  if (depth > MAX_DEPTH) throw new Error(`receita de ${name} é complexa demais`)

  const best = bestRecipe(bot, item.id, needed)
  if (!best) throw new Error(`${name} não é fabricável (precisa coletar ou fundir)`)
  const { recipe } = best
  const times = Math.ceil(needed / recipe.result.count)

  // A mesa vem primeiro: fabricá-la consome tábuas que a receita também pode usar.
  let table = null
  if (recipe.requiresTable) {
    table = await ensureStation(bot, 'crafting_table', isCancelled, depth)
    if (isCancelled()) return
  }

  for (const missing of missingFor(bot, recipe, times)) {
    if (isCancelled()) return
    const ingredient = itemName(bot, missing.id)
    if (!bot.recipesAll(missing.id, null, true).length) {
      const source = rawSource(ingredient)
      if (!source) throw new Error(`falta ${missing.count}x ${ingredient}`)
      if (source.needsPickaxe && !hasPickaxe(bot)) await craftItem(bot, 'wooden_pickaxe', 1, isCancelled)
      if (isCancelled()) return
      console.log(`Coletando ${source.what} para ${name}`)
      const got = await mineBlocks(bot, source.blocks, source.amount(missing.count), isCancelled)
      if (!got && !isCancelled()) throw new Error(`falta ${source.what} e não achei por perto`)
      throw new Replan(`coletei ${got}x ${source.what}`)
    }
    await craftStep(bot, ingredient, countItem(bot, missing.id) + missing.count, isCancelled, depth + 1)
  }
  if (isCancelled()) return
  // Fabricar um ingrediente pode ter gasto outro (ex.: gravetos gastam tábuas).
  const stillMissing = missingFor(bot, recipe, times)
  if (stillMissing.length) throw new Replan(`ainda falta ${stillMissing.map((m) => `${m.count}x ${itemName(bot, m.id)}`).join(', ')}`)

  if (table) {
    await goTo(bot, new goals.GoalGetToBlock(table.position.x, table.position.y, table.position.z))
    if (isCancelled()) return
  }
  console.log(`Fabricando ${times * recipe.result.count}x ${name}${table ? ' (mesa)' : ''}`)
  const before = countItem(bot, item.id)
  try {
    await bot.craft(recipe, times, table)
  } catch (err) {
    // Na mesa, o servidor às vezes não confirma o espaço do resultado como o
    // mineflayer espera, mas o item é fabricado. Visto no 26.3 E no 1.20.1.
    if (/did not fire within timeout/i.test(err.message)) {
      if (bot.currentWindow) bot.closeWindow(bot.currentWindow)
      await sleep(1000)
      if (countItem(bot, item.id) > before) return
      throw new Replan('a mesa não confirmou e o item não apareceu')
    }
    // Inventário local desatualizado (o craft anterior ainda não refletiu):
    // espera sincronizar e refaz o plano.
    if (!/missing ingredient/i.test(err.message)) throw err
    await sleep(800)
    throw new Replan(`inventário desatualizado (${err.message})`)
  }
  // No 26.3 o inventário pode demorar a refletir o craft (janelas dessincronizam).
  for (let i = 0; i < 20 && countItem(bot, item.id) <= before; i++) await sleep(100)
}

// Coloca `count` itens na fornalha (com combustível) e espera recolher o resultado.
async function smeltItem(bot, name, count, isCancelled) {
  const result = smeltResult(name)
  if (!result) throw new Error(`${name} não vai na fornalha`)
  const input = bot.registry.itemsByName[name]
  count = Math.min(count, countItem(bot, input.id))
  if (count <= 0) throw new Error(`não tenho ${name}`)

  const fuels = bot.inventory.items()
    .filter((i) => fuelValue(i.name) > 0 && i.name !== name)
    .sort((a, b) => fuelValue(b.name) - fuelValue(a.name))
  if (!fuels.length) throw new Error('não tenho combustível (carvão, madeira ou tábuas)')
  const fuel = fuels[0]
  const fuelCount = Math.min(fuel.count, Math.ceil(count / fuelValue(fuel.name)))
  if (fuelCount * fuelValue(fuel.name) < count) count = Math.floor(fuelCount * fuelValue(fuel.name))

  const furnaceBlock = await ensureStation(bot, 'furnace', isCancelled, 0)
  if (isCancelled() || !furnaceBlock) return 0
  await goTo(bot, new goals.GoalGetToBlock(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z))
  if (isCancelled()) return 0

  const furnace = await bot.openFurnace(furnaceBlock)
  let collected = 0
  try {
    if (!furnace.fuelItem()) await furnace.putFuel(fuel.type, null, fuelCount)
    await furnace.putInput(input.id, null, count)
    console.log(`Na fornalha: ${count}x ${name} -> ${result} (combustível ${fuelCount}x ${fuel.name})`)
    // Cada item leva 10s; espera com folga e recolhe conforme sai.
    const deadline = Date.now() + count * 10000 + 15000
    while (collected < count && Date.now() < deadline && !isCancelled()) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const out = furnace.outputItem()
      if (out) {
        await furnace.takeOutput()
        collected += out.count
      }
    }
  } finally {
    furnace.close()
  }
  return collected
}

// Comida crua do inventário que vale a pena cozinhar.
function rawFoods(bot) {
  return bot.inventory.items().filter((i) => RAW_FOODS.includes(i.name))
}

function canCraftFromInventory(bot, name, count = 1) {
  const item = bot.registry?.itemsByName?.[name]
  return Boolean(item) && shortfall(bot, item.id, countItem(bot, item.id) + count) === 0
}

module.exports = { craftItem, smeltItem, smeltResult, rawFoods, countItem, canCraftFromInventory }
