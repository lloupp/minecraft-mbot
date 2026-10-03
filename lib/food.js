// lib/food.js
// Comer o que tem no inventário e, se não tiver nada, buscar comida:
// caçar animais, colher plantações maduras e frutas de arbustos.

const { goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const { fight } = require('./combat')

const SEARCH_RANGE = 48
const KEEP_ALIVE = 2 // animais de cada espécie que o bot nunca caça

// Comidas que fazem mal (fome, veneno, náusea): só em último caso.
const BAD_FOODS = new Set(['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chicken', 'suspicious_stew', 'chorus_fruit'])

// Animais que deixam comida ao morrer.
const FOOD_ANIMALS = new Set(['cow', 'pig', 'sheep', 'chicken', 'rabbit', 'mooshroom'])

// Plantação -> { idade em que está madura, semente para replantar }.
// Trigo fica de fora: vira comida só com crafting (pão).
const CROPS = {
  carrots: { age: 7, seed: 'carrot' },
  potatoes: { age: 7, seed: 'potato' },
  beetroots: { age: 3, seed: 'beetroot_seeds' }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Comidas do inventário, da melhor para a pior.
function foodItems(bot, allowBad = false) {
  const foods = bot.registry.foodsByName
  return bot.inventory.items()
    .filter((item) => foods[item.name] && (allowBad || !BAD_FOODS.has(item.name)))
    .sort((a, b) => foods[b.name].effectiveQuality - foods[a.name].effectiveQuality)
}

function hasFood(bot) {
  return foodItems(bot, bot.food <= 6).length > 0
}

// Come a melhor comida disponível. Com muita fome, aceita comida ruim.
// `preferred`: comida favorita (preferência do dono), usada primeiro se houver.
async function eat(bot, { preferred = null } = {}) {
  const items = foodItems(bot, bot.food <= 6)
  const item = (preferred && items.find((i) => i.name === preferred)) || items[0]
  if (!item) return null
  await bot.equip(item, 'hand')
  await bot.consume()
  return item.name
}

// pathfinder.goto com limite de tempo (caminhos impossíveis podem demorar muito).
async function goTo(bot, goal, ms = 15000) {
  let timer
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      bot.pathfinder.setGoal(null)
      reject(new Error('caminho demorou demais'))
    }, ms)
  })
  try {
    await Promise.race([bot.pathfinder.goto(goal), timeout])
  } finally {
    clearTimeout(timer)
  }
}

// Fonte de comida mais próxima: animal, plantação madura ou arbusto com frutas.
// `spare(entity)` poupa animais que não podem ser caçados (ex.: os do curral).
function findFoodSource(bot, { spare = () => false } = {}) {
  const pos = bot.entity.position
  const sources = []
  const huntable = (e) => FOOD_ANIMALS.has(e.name) && e.position.distanceTo(pos) <= SEARCH_RANGE && !spare(e)

  // Poupa os últimos de cada espécie para os animais poderem se reproduzir.
  const population = {}
  for (const e of Object.values(bot.entities)) {
    if (huntable(e)) population[e.name] = (population[e.name] || 0) + 1
  }
  // Morrendo de fome, caça até os últimos.
  const keep = bot.food <= 4 ? 0 : KEEP_ALIVE
  const animal = bot.nearestEntity((e) => huntable(e) && population[e.name] > keep)
  if (animal) sources.push({ kind: 'animal', entity: animal, dist: animal.position.distanceTo(pos) })

  const cropIds = new Set(Object.keys(CROPS).map((name) => bot.registry.blocksByName[name]?.id).filter(Boolean))
  const berryId = bot.registry.blocksByName.sweet_berry_bush?.id
  const block = bot.findBlock({
    maxDistance: SEARCH_RANGE,
    useExtraInfo: true,
    matching: (b) => {
      if (cropIds.has(b.type)) return b.getProperties().age >= CROPS[b.name].age
      if (b.type === berryId) return b.getProperties().age >= 2
      return false
    }
  })
  if (block) {
    sources.push({ kind: block.name === 'sweet_berry_bush' ? 'berries' : 'crop', block, dist: block.position.distanceTo(pos) })
  }

  return sources.sort((a, b) => a.dist - b.dist)[0] || null
}

// Anda até os itens caídos perto de `center` para pegá-los.
async function collectDrops(bot, center, isCancelled, { timeoutMs = Infinity, radius = 6, matches = () => true, done = () => false, beforeMove = () => {} } = {}) {
  const deadline = Date.now() + timeoutMs
  const stopped = () => isCancelled() || done() || Date.now() >= deadline
  const nearbyDrops = () => Object.values(bot.entities)
    .filter((e) => e.name === 'item' && e.isValid !== false && e.position.distanceTo(center) <= radius && matches(e))

  // Drops podem aparecer com atraso ou cair em buracos; espera e passa mais de uma vez.
  for (let waited = 0; waited < 1500 && !stopped() && !nearbyDrops().length; waited += 250) await sleep(250)
  for (let round = 0; round < 3 && !stopped(); round++) {
    const drops = nearbyDrops()
    if (!drops.length) break
    for (const drop of drops) {
      if (stopped()) break
      if (drop.isValid === false) continue
      beforeMove(drop)
      if (stopped() || drop.isValid === false) break
      const p = drop.position
      const budget = () => Math.min(6000, Math.max(1, deadline - Date.now()))
      await goTo(bot, new goals.GoalNear(p.x, p.y, p.z, 0.5), budget()).catch(async () => {
        // Drop numa célula sem altura para ficar (ex.: sob os troncos restantes de uma árvore):
        // o alvo exato é inalcançável, mas uma célula adjacente já está no alcance de coleta.
        if (stopped() || drop.isValid === false) return
        beforeMove(drop)
        if (stopped() || drop.isValid === false) return
        await goTo(bot, new goals.GoalNear(p.x, p.y, p.z, 1), budget()).catch(() => {})
      })
    }
    await sleep(300)
  }
}

async function hunt(bot, target, isCancelled) {
  // Animais não revidam: pode lutar até com pouca vida.
  const result = await fight(bot, target, isCancelled, { retreatHealth: 0 })
  if (result !== 'morto') return false
  await collectDrops(bot, target.position.clone(), isCancelled)
  return true
}

async function harvestCrop(bot, block, isCancelled) {
  const { x, y, z } = block.position
  await goTo(bot, new goals.GoalGetToBlock(x, y, z))
  if (isCancelled()) return false
  const cropName = block.name
  await bot.dig(bot.blockAt(block.position))
  await collectDrops(bot, block.position, isCancelled)
  // Replanta para a plantação não acabar.
  const seed = bot.inventory.items().find((i) => i.name === CROPS[cropName].seed)
  const soil = bot.blockAt(block.position.offset(0, -1, 0))
  if (seed && soil?.name === 'farmland' && !isCancelled()) {
    await bot.equip(seed, 'hand')
    await bot.placeBlock(soil, new Vec3(0, 1, 0)).catch(() => {})
  }
  return true
}

async function pickBerries(bot, block, isCancelled) {
  const { x, y, z } = block.position
  await goTo(bot, new goals.GoalGetToBlock(x, y, z))
  if (isCancelled()) return false
  await bot.activateBlock(bot.blockAt(block.position))
  await collectDrops(bot, block.position, isCancelled)
  return true
}

// Busca uma fonte de comida e a coleta. Retorna uma descrição do que fez, ou null.
async function gatherFood(bot, isCancelled, options) {
  const source = findFoodSource(bot, options)
  if (!source) return null
  if (source.kind === 'animal') {
    console.log(`Caçando ${source.entity.name} a ${source.dist.toFixed(0)} blocos`)
    return (await hunt(bot, source.entity, isCancelled)) ? `cacei um(a) ${source.entity.name}` : null
  }
  console.log(`Colhendo ${source.block.name} a ${source.dist.toFixed(0)} blocos`)
  if (source.kind === 'berries') {
    return (await pickBerries(bot, source.block, isCancelled)) ? 'colhi frutas' : null
  }
  return (await harvestCrop(bot, source.block, isCancelled)) ? `colhi ${source.block.name}` : null
}

module.exports = { eat, hasFood, gatherFood, findFoodSource, goTo, collectDrops }
