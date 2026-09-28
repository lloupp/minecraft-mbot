// lib/real-state.js
// Traduz o bot real (mineflayer) para o mesmo formato de estado usado pelo
// Gauntlet V2 (lib/player-loop.js), só para o shadow mode observar o Laya em
// paralelo. Isto NUNCA decide nada: é uma leitura best-effort, usada apenas
// para gerar os `candidates` que o Laya vê e para registrar o que aconteceu.
//
// Limitações conhecidas (documentadas para não passar confiança falsa):
// - `nearby` (comida/madeira/pedra por perto) não é escaneado no mundo real
//   nesta primeira iteração: fica sempre `{}`, então os ramos de
//   `candidateIntents` que dependem disso nunca disparam ainda.
// - `alternativeRoute` e `waitReason` ficam sempre neutros (false/null): o
//   runtime atual não expõe essa informação de forma barata.
// - `consecutiveFailures` é contado só a partir de quando o shadow mode está
//   ativo (reseta ao reiniciar o bot), não é um histórico persistido.

const { refreshCapabilities, WEAPON_SCORE, PICKAXE_SCORE } = require('./player-loop')
const { isNight } = require('./night')

// Tarefas do runtime atual cujo tipo bate com um `objective.type` que
// `lib/player-loop.js` já sabe interpretar (`needsPickaxe`,
// `combatPreparationUseful`). Fora daqui, o tipo original passa como está e
// só os ramos genéricos de `candidateIntents` se aplicam.
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

function nearestThreat(bot, range) {
  const entity = bot?.nearestEntity?.((e) => e.type === 'hostile' &&
    e.position?.distanceTo(bot.entity.position) <= range)
  if (!entity) return null
  return {
    type: entity.name,
    distance: Math.round(entity.position.distanceTo(bot.entity.position)),
    count: 1
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
function realStateSnapshot(bot, task, { homeProvider, fleeDistance = 16, consecutiveFailures = 0 } = {}) {
  const home = homeProvider?.() || null
  const inventory = inventoryCounts(bot)
  const state = {
    health: Number(bot?.health ?? 0),
    food: Number(bot?.food ?? 0),
    inventory,
    inventoryLoad: bot?.inventory?.slots
      ? Math.min(1, bot.inventory.items().length / 36)
      : 0,
    equippedWeapon: bestEquipped(bot, WEAPON_SCORE),
    equippedTool: bestEquipped(bot, PICKAXE_SCORE),
    threat: nearestThreat(bot, fleeDistance),
    time: isNight(bot) ? 'night' : 'day',
    atBase: isAtBase(bot, home),
    baseKnown: Boolean(home),
    nearby: {},
    consecutiveFailures: Math.max(0, Number(consecutiveFailures) || 0),
    alternativeRoute: false,
    waitReason: null,
    cancellationRequested: false,
    objective: task ? { type: objectiveTypeFor(task), completed: false } : null
  }
  return refreshCapabilities(state)
}

module.exports = { realStateSnapshot, objectiveTypeFor }
