// lib/food.js
// Comer o que tem no inventário e, se não tiver nada, buscar comida:
// caçar animais, colher plantações maduras e frutas de arbustos.

const { goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const { fight } = require('./combat')

const SEARCH_RANGE = 48
const APPROACH_BEFORE_HUNT = 16
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
// Animal caçável mais próximo (só entidades: barato). Poupa os últimos de cada espécie, salvo com fome extrema.
function findHuntableAnimal(bot, { spare = () => false } = {}) {
  const pos = bot.entity.position
  const huntable = (e) => FOOD_ANIMALS.has(e.name) && e.position.distanceTo(pos) <= SEARCH_RANGE && !spare(e)

  // Poupa os últimos de cada espécie para os animais poderem se reproduzir.
  const population = {}
  for (const e of Object.values(bot.entities)) {
    if (huntable(e)) population[e.name] = (population[e.name] || 0) + 1
  }
  // Morrendo de fome, caça até os últimos.
  const keep = bot.food <= 4 ? 0 : KEEP_ALIVE
  return bot.nearestEntity((e) => huntable(e) && population[e.name] > keep)
}

function findFoodSource(bot, { spare = () => false } = {}) {
  const pos = bot.entity.position
  const sources = []
  const animal = findHuntableAnimal(bot, { spare })
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

const NUDGE_MAX_GAP = 2.5

// Anda até os itens caídos perto de `center` para pegá-los.
const NUDGE_LIQUIDS = new Set(['water', 'lava', 'fire', 'soul_fire', 'cactus', 'magma_block', 'sweet_berry_bush'])

// O empurrão anda às cegas por ~2,5 blocos: só com o item no mesmo nível (|Δy| <= 1) e chão firme, sem líquido/fogo,
// no ponto do item e no trecho até ele (a 1/3 e 2/3). Sem blockAt (testes/stubs) não há o que checar.
function nudgeIsSafe(bot, p) {
  const position = bot.entity?.position
  if (typeof bot.blockAt !== 'function' || !position) return true
  if (Math.abs(p.y - position.y) > 1) return false
  const probe = (x, z) => {
    const at = bot.blockAt({ x: Math.floor(x), y: Math.floor(p.y), z: Math.floor(z) })
    const below = bot.blockAt({ x: Math.floor(x), y: Math.floor(p.y) - 1, z: Math.floor(z) })
    if (!at || !below) return false
    if (NUDGE_LIQUIDS.has(at.name) || NUDGE_LIQUIDS.has(below.name)) return false
    return below.boundingBox === 'block'
  }
  return [1, 2 / 3, 1 / 3, 0].every((t) => probe(p.x + (position.x - p.x) * t, p.z + (position.z - p.z) * t))
}

// Avança até 600 ms em direção a (p.x, p.z); a colisão limita o avanço. Sempre solta o controle.
async function nudgeToward(bot, p, halted) {
  const position = bot.entity?.position
  if (typeof bot.setControlState !== 'function' || !position) return
  const gap = Math.hypot(p.x - position.x, p.z - position.z)
  // Só corrige quase-acertos (item logo fora da janela de coleta); longe disso o pathfinder falhou e andar às cegas é risco.
  if (gap <= 1.2 || gap > NUDGE_MAX_GAP) return
  if (!nudgeIsSafe(bot, p)) return
  try {
    await bot.lookAt?.(p, true)
    bot.setControlState('forward', true)
    for (let waited = 0; waited < 600 && !halted(); waited += 50) await sleep(50)
  } finally {
    bot.setControlState('forward', false)
  }
}

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
      const budget = (cap = 6000) => Math.min(cap, Math.max(1, deadline - Date.now()))
      // Alvo exato primeiro, mas com teto: num nicho inalcançável (ex.: sob os troncos restantes de uma
      // árvore) o pathfinder gasta todo o orçamento procurando, ou resolve sem se mover a ~1,5 do item.
      await goTo(bot, new goals.GoalNear(p.x, p.y, p.z, 0.5), budget(1500)).catch(async () => {
        if (stopped() || drop.isValid === false) return
        beforeMove(drop)
        if (stopped() || drop.isValid === false) return
        await goTo(bot, new goals.GoalNear(p.x, p.y, p.z, 1), budget()).catch(() => {})
      })
      // A janela de coleta é |Δ| < 1,425 (0,3 + 1,0 + 0,125): se o item ficou fora dela, empurrão curto.
      if (!stopped() && drop.isValid !== false) await nudgeToward(bot, p, () => stopped() || drop.isValid === false)
    }
    await sleep(300)
  }
}

async function hunt(bot, target, isCancelled) {
  // findFoodSource procura até 48 blocos, mas a luta desiste com o alvo a mais de 24 (combat GIVE_UP_DIST): sem se
  // aproximar antes, toda caça entre 24 e 48 voltava 'fugiu' na hora (visto no Minecraft: galinha a 36 blocos, 2×).
  if (target.position.distanceTo(bot.entity.position) > APPROACH_BEFORE_HUNT) {
    await goTo(bot, new goals.GoalNear(target.position.x, target.position.y, target.position.z, 3), 20000).catch(() => {})
    if (isCancelled() || target.isValid === false) return false
  }
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

module.exports = { eat, hasFood, foodItems, hunt, gatherFood, findFoodSource, findHuntableAnimal, goTo, collectDrops }
