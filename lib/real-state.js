// lib/real-state.js
// Traduz o bot real (mineflayer) para o mesmo formato de estado usado pelo
// Gauntlet V2 (lib/player-loop.js), só para o shadow mode observar o Laya em
// paralelo. Isto NUNCA decide nada: é uma leitura best-effort, usada apenas
// para gerar os `candidates` que o Laya vê e para registrar o que aconteceu.
//
// Limitações conhecidas (documentadas para não passar confiança falsa):
// - `nearby` usa uma amostragem espacial pequena e limitada com `blockAt`,
//   apenas no instante da captura do shadow. Não usa `findBlock/findBlocks` e
//   não tenta ser um inventário completo do chunk.
// - `alternativeRoute` e `waitReason` ficam neutros (false/null): o runtime
//   atual ainda não expõe evidência confiável de rota alternativa/espera.
// - `consecutiveFailures` é contado só a partir de quando o shadow mode está
//   ativo (reseta ao reiniciar o bot), não é um histórico persistido.

const { refreshCapabilities, WEAPON_SCORE, PICKAXE_SCORE } = require('./player-loop')
const { isNight, findShelterSpot, findBed } = require('./night')
const { findHuntableAnimal, foodItems } = require('./food')

// Tarefas do runtime atual cujo tipo bate com um `objective.type` que
// `lib/player-loop.js` já sabe interpretar (`needsPickaxe`,
// `combatPreparationUseful`). Fora daqui, o tipo original passa como está e
// só os ramos genéricos de `candidateIntents` se aplicam.

const FOOD_ANIMALS = new Set(['cow', 'pig', 'chicken', 'sheep', 'rabbit'])
const FOOD_BLOCKS = new Set(['wheat', 'carrots', 'potatoes', 'beetroots', 'sweet_berry_bush', 'melon', 'pumpkin'])
const STONE_BLOCKS = new Set(['stone', 'cobblestone', 'andesite', 'diorite', 'granite', 'deepslate', 'cobbled_deepslate'])
const IRON_BLOCKS = new Set(['iron_ore', 'deepslate_iron_ore', 'raw_iron_block'])

const FOOD_SIGHT = 16

function nearbySignals(bot, radius = 4) {
  const out = { food: false, wood: false, stone: false, iron: false, foodDistance: null, woodDistance: null, stoneDistance: null, ironDistance: null }
  const origin = bot?.entity?.position
  if (!origin) return out

  for (const entity of Object.values(bot?.entities || {})) {
    if (!entity?.position || entity === bot.entity) continue
    const animal = FOOD_ANIMALS.has(entity.name)
    // Animais visíveis a até 16 blocos contam como comida próxima (com 8, em terreno aberto o explorador com fome
    // nunca recebia find_food e morria de fome na base). Blocos continuam na amostra curta abaixo.
    if (entity.position.distanceTo(origin) > (animal ? FOOD_SIGHT : Math.max(8, radius * 2))) continue
    if (animal) {
      out.food = true
      const d = entity.position.distanceTo(origin)
      out.foodDistance = out.foodDistance == null ? d : Math.min(out.foodDistance, d)
    }
  }

  // Amostra fixa e limitada: 125 blockAt calls com radius=4 e step=2.
  // A captura do shadow ocorre no início da tarefa, não em loop por tick.
  const step = 2
  const yOffsets = [-2, -1, 0, 1, 2]
  for (let dx = -radius; dx <= radius; dx += step) {
    for (const dy of yOffsets) {
      for (let dz = -radius; dz <= radius; dz += step) {
        let block = null
        try { block = bot.blockAt(origin.offset(dx, dy, dz)) } catch { block = null }
        const name = block?.name
        if (!name) continue
        const d = origin.distanceTo(origin.offset(dx, dy, dz))
        if (name.endsWith('_log') || name.endsWith('_stem')) {
          out.wood = true
          out.woodDistance = out.woodDistance == null ? d : Math.min(out.woodDistance, d)
        }
        if (STONE_BLOCKS.has(name)) {
          out.stone = true
          out.stoneDistance = out.stoneDistance == null ? d : Math.min(out.stoneDistance, d)
        }
        if (IRON_BLOCKS.has(name)) {
          out.iron = true
          out.ironDistance = out.ironDistance == null ? d : Math.min(out.ironDistance, d)
        }
        if (FOOD_BLOCKS.has(name)) {
          out.food = true
          out.foodDistance = out.foodDistance == null ? d : Math.min(out.foodDistance, d)
        }
      }
    }
  }
  return out
}

const ORE_RESOURCE = /iron|gold|diamond|copper|coal|emerald|redstone|lapis/i
function objectiveTypeFor(task) {
  if (task?.type === 'coletar_blocos' && ORE_RESOURCE.test(task.resource || '')) return 'mine_iron'
  if (task?.type === 'explorar') return 'explore'
  if (task?.type === 'guardar') return 'guard'
  return task?.type || null
}

function inventoryCounts(bot) {
  const inventory = {}
  for (const item of bot?.inventory?.items?.() || []) {
    inventory[item.name] = (inventory[item.name] || 0) + item.count
  }
  return inventory
}

function bestEquipped(bot, scores) {
  const held = bot?.heldItem?.name
  return held && scores[held] ? held : null
}

// Neutros enquanto não provocados: aranha de dia, enderman sempre. Longe, não são ameaça (um ataque real dispara o
// reflexo de dano do worker). Visto no Minecraft: uma aranha parada a 14 blocos de dia prendeu o explorador ~10 min
// em fuga sem sair do lugar.
const NEUTRAL_NEAR = 3
function provokedOrHostile(bot, e, distance) {
  if (distance <= NEUTRAL_NEAR) return true
  if (e.name === 'enderman') return false
  if ((e.name === 'spider' || e.name === 'cave_spider') && !isNight(bot)) return false
  return true
}

function nearestThreat(bot, range, ignore = () => false) {
  const isHostileNearby = (e) => {
    if (e?.type !== 'hostile' || ignore(e)) return false
    const distance = e.position?.distanceTo(bot.entity.position)
    return distance <= range && provokedOrHostile(bot, e, distance)
  }
  const entity = bot?.nearestEntity?.(isHostileNearby)
  if (!entity) return null
  // Conta todas as ameaças no raio, não só a mais próxima: `immediateSafety`
  // (lib/player-loop.js) força fuga quando `count >= 3` (enxame), e reportar
  // sempre 1 aqui esconderia esse cenário do shadow mode mesmo com o bot
  // real cercado.
  const count = Object.values(bot?.entities || {}).filter(isHostileNearby).length || 1
  return {
    type: entity.name,
    distance: Math.round(entity.position.distanceTo(bot.entity.position)),
    count
  }
}

function isAtBase(bot, home, radius = 6) {
  if (!home || !bot?.entity?.position) return false
  const dx = bot.entity.position.x - home.x
  const dy = bot.entity.position.y - home.y
  const dz = bot.entity.position.z - home.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz) <= radius
}

// `fleeDistance`: mesmo raio de detecção de ameaça já usado pelos reflexos de
// combate do WorkerController (`FLEE_DISTANCE`), para não inventar um novo.
// `deep`: percepção mais cara (comida caçável a 48, abrigo/cama) só para snapshots de decisão. Visto no Minecraft: o
// monitor do executor tira snapshot a cada 250 ms; com a busca de comida (findBlock de 48 blocos, ~1,2 s) no snapshot o
// laço de eventos travava, o servidor expulsava o bot ('floating too long'/'Timed out') e o processo caía (EPIPE).
// `ignoreThreat`: monstros que o worker não conseguiu alcançar numa luta recente (o reflexo de dano continua valendo).
function realStateSnapshot(bot, task, { homeProvider, fleeDistance = 16, consecutiveFailures = 0, deep = false, ignoreThreat } = {}) {
  const home = homeProvider?.() || null
  const inventory = inventoryCounts(bot)
  const shelterKind = deep && isNight(bot) ? shelterSpotKind(bot) : null
  const state = {
    health: Number(bot?.health ?? 0),
    food: Number(bot?.food ?? 0),
    inventory,
    // Comida que o bot comeria agora (inclui carne crua; comida ruim só com muita fome, como food.eat).
    edibleFood: edibleFoodCount(bot),
    inventoryLoad: bot?.inventory?.slots
      ? Math.min(1, bot.inventory.items().length / 36)
      : 0,
    equippedWeapon: bestEquipped(bot, WEAPON_SCORE),
    equippedTool: bestEquipped(bot, PICKAXE_SCORE),
    threat: nearestThreat(bot, fleeDistance, ignoreThreat),
    // Oxigênio só cai com a cabeça submersa (20 = cheio).
    drowning: Number(bot?.oxygenLevel ?? 20) < 18,
    time: isNight(bot) ? 'night' : 'day',
    atBase: isAtBase(bot, home),
    baseKnown: Boolean(home),
    baseDistance: home && bot?.entity?.position ? bot.entity.position.distanceTo(home) : null,
    nearby: deep && Number(bot?.food ?? 20) <= 10 ? withFoodSource(bot, nearbySignals(bot)) : nearbySignals(bot),
    // Abrigo: o executor (lib/night.js) cava um buraco seguro perto do bot; só vale a pena olhar de noite. Só nas
    // decisões (deep): o monitor do executor tira snapshot a cada 250 ms.
    shelterNearby: Boolean(shelterKind),
    shelterKind,
    consecutiveFailures: Math.max(0, Number(consecutiveFailures) || 0),
    alternativeRoute: false,
    waitReason: null,
    cancellationRequested: false,
    objective: task ? { type: objectiveTypeFor(task), completed: false } : null
  }
  return refreshCapabilities(state)
}

// Comida próxima = o que o executor de comida aceitaria: animal caçável a até 48 (poupa os últimos de cada espécie,
// salvo com fome extrema) ou plantação madura/frutas por perto. Com 16 blocos fixos, em terreno de animais esparsos
// find_food quase nunca era oferecido (r3: 7 de 516 decisões). E a amostra barata contava qualquer animal e qualquer
// planta: visto no Minecraft (linha de base, braço de controle) 125 find_food seguidos "comida a 5–15 blocos" que o
// executor recusava (galinhas poupadas, plantas verdes).
const MATURE_FOOD_RANGE = 8
function withFoodSource(bot, nearby) {
  if (typeof bot?.nearestEntity !== 'function') return nearby
  const out = { ...nearby, food: false, foodDistance: null }
  const here = bot.entity.position
  try {
    const animal = findHuntableAnimal(bot)
    if (animal) { out.food = true; out.foodDistance = animal.position.distanceTo(here) }
  } catch { /* percepção é melhor esforço */ }
  try {
    const plant = typeof bot.findBlock === 'function' && bot.findBlock({ maxDistance: MATURE_FOOD_RANGE, useExtraInfo: true, matching: matureFood })
    if (plant) {
      const d = plant.position.distanceTo(here)
      out.food = true
      out.foodDistance = out.foodDistance == null ? d : Math.min(out.foodDistance, d)
    }
  } catch { /* idem */ }
  return out
}

const MATURE_AGE = { carrots: 7, potatoes: 7, beetroots: 3, sweet_berry_bush: 2 }
function matureFood(block) {
  const age = MATURE_AGE[block?.name]
  if (age == null) return false
  try { return Number(block.getProperties?.().age) >= age } catch { return false }
}

// Como o executor de noite se abrigaria aqui: 'bed' (cama a ≤32), 'dig' (buraco tampável) ou null.
function shelterSpotKind(bot) {
  if (typeof bot?.blockAt !== 'function' || !bot?.entity?.position?.floored) return null
  try { if (typeof bot.findBlock === 'function' && findBed(bot)) return 'bed' } catch { /* sem cama conhecida */ }
  try { return findShelterSpot(bot) ? 'dig' : null } catch { return null }
}

function edibleFoodCount(bot) {
  if (!bot?.registry?.foodsByName || typeof bot?.inventory?.items !== 'function') return null
  try { return foodItems(bot, Number(bot.food ?? 20) <= 6).reduce((n, item) => n + item.count, 0) } catch { return null }
}

module.exports = { realStateSnapshot, objectiveTypeFor, nearbySignals }
