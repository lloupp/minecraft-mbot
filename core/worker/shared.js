// core/worker/shared.js
// Constantes e funções usadas por vários comportamentos do WorkerController.

const gather = require('../../lib/gather')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const HUNGRY = 14         // abaixo disso come o que tiver
const FLEE_DISTANCE = 16  // distância que tenta manter da ameaça
const FLEE_MS = 4000      // tempo fugindo
const CREEPER_RANGE = 5   // creeper mais perto que isso: foge
// Blocos naturais que podem ser cavados para abrir a linha do curral.
const NATURAL_TERRAIN = /^(grass_block|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|mud|clay|sand|red_sand|gravel|stone|andesite|diorite|granite|tuff|snow_block)$/
// Todos os workers dividem o mesmo processo Node. Com o padrão do pathfinder
// (40 ms de A* por tick), 7 workers calculando caminhos longos ao mesmo tempo
// saturavam a CPU e o servidor os derrubava por "Timed out".
const PATH_TICK_MS = 8
// O thinkTimeout conta tempo de relógio, não de cálculo: com 8 ms por tick o
// padrão de 5 s dá ~0,8 s de A* e caminhos longos falhavam com "Took to long".
// 25 s mantém o mesmo cálculo que 5 s com o tickTimeout padrão de 40 ms.
const PATH_THINK_MS = 25000
// Tempo para uma viagem longa: ~700 ms por bloco (medido ~2 blocos/s com vários
// workers calculando caminho ao mesmo tempo), nunca menos de 30 s.
const MS_PER_BLOCK = 700
const POINT_ARRIVAL_RADIUS = 2
const PREPARATION_SITE_TTL_MS = 90000
const PREPARATION_SITE_MAX_DISTANCE = 16
const PREPARATION_STAGING_MAX_DISTANCE = 8
const PREPARATION_STAGING_SAFETY_POLL_MS = 100
const EXPLORE_FAR_MARGIN = 32
// À noite, a cama da base conta como abrigo até esta distância (o executor volta à base e dorme).
const BASE_BED_TRAVEL = 64
// Trabalhando sem sair de um raio de 2 blocos por tanto tempo (fora de abrigo/cama): registra o contexto e libera o
// worker. Visto no Minecraft: 24 min parado num ponto do qual um bot de teste sai em 6 s, sem causa identificada.
const NO_PROGRESS_MS = Number(process.env.MBOT_NO_PROGRESS_MS || 180000)
const NO_PROGRESS_RADIUS = 2
const NO_PROGRESS_IDLE_RESET_MS = 30000
const THREAT_IGNORE_MS = 60000
const FAILED_HUNT_MS = 300000
const BASE_UNREACHABLE_MS = 120000
const SHELTER_BLOCKED_MS = 120000
const DEATH_DROPS_MS = 240000
const INVENTORY_DESYNC = /RECIPE_INPUTS_(CHANGED|NOT_CONFIRMED)|did not fire within timeout/
const COOKABLE = new Set(['beef', 'porkchop', 'mutton', 'chicken', 'rabbit', 'cod', 'salmon', 'potato'])
const DEATH_DROPS_RANGE = 96
// Escape cavando: pedra à mão leva ~7 s por bloco; com 20 s o explorador não saía de uma caverna ao lado da base.
const DIG_ESCAPE_MS = 60000
// Correções de posição seguidas do servidor (forcedMove) sem progresso: ~2 s de ticks rejeitados.
const GOTO_REJECTED_MOVES = 40
// Falhas de movimento que significam "não deu para chegar daqui" (e não cancelamento/troca de dono).
const UNREACHED_MOVE = /No path to the goal|caminho demorou demais|Took to long to decide path|servidor rejeitou o movimento/
const PHYSICAL_PREPARATION_REFUSALS = new Set(['TARGET_BLOCKED', 'APPROVED_TARGETS_INSUFFICIENT', 'MINING_PICKAXE_REQUIRED', 'COBBLESTONE_DROP_REQUIRED', 'NEARBY_TABLE_REQUIRED'])
const NAVIGATION_POSITION_NOT_CONFIRMED = 'NAVIGATION_POSITION_NOT_CONFIRMED'
function travelTimeoutMs(from, to) {
  if (!from || !to) return 30000
  const d = Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z)
  return Math.max(30000, Math.round(d * MS_PER_BLOCK))
}

function summarizeGatherRecovery(evidence = []) {
  const failedWithAlternate = evidence.findIndex((attempt) =>
    attempt?.code &&
    attempt.code !== gather.COLLECTION_FAILURE.CANCELLED &&
    attempt.alternateTargetCandidateObserved === true
  )
  if (failedWithAlternate < 0) {
    return { alternateTargetObserved: false, alternateTargetRecoveryConfirmed: false }
  }
  return {
    alternateTargetObserved: true,
    alternateTargetRecoveryConfirmed: evidence
      .slice(failedWithAlternate + 1)
      .some((attempt) => attempt?.itemConfirmed === true)
  }
}

function shadowObjectiveKey(task) {
  if (!task) return 'none'
  const point = (value) => value && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y)) && Number.isFinite(Number(value.z))
    ? [Math.floor(Number(value.x)), Math.floor(Number(value.y)), Math.floor(Number(value.z))]
    : null
  return JSON.stringify({
    type: task.type || null,
    resource: task.resource || null,
    item: task.item || null,
    product: task.product || null,
    species: task.species || null,
    planta: task.planta || null,
    region: task.region || null,
    position: point(task.position),
    center: point(task.center),
    origin: point(task.origin)
  })
}

// Cercas e portões nunca podem ser quebrados pelo pathfinder: um buraco no
// curral solta os animais (e com canOpenDoors=false ele prefere cavar a cerca).
function protectPenBlocks(moves, registry) {
  for (const block of registry?.blocksArray || []) {
    if (block.name.endsWith('_fence') || block.name.endsWith('_fence_gate')) {
      moves.blocksCantBreak.add(block.id)
    }
  }
  return moves
}

module.exports = { sleep, HUNGRY, FLEE_DISTANCE, FLEE_MS, CREEPER_RANGE, NATURAL_TERRAIN, PATH_TICK_MS, PATH_THINK_MS, MS_PER_BLOCK, POINT_ARRIVAL_RADIUS, PREPARATION_SITE_TTL_MS, PREPARATION_SITE_MAX_DISTANCE, PREPARATION_STAGING_MAX_DISTANCE, PREPARATION_STAGING_SAFETY_POLL_MS, EXPLORE_FAR_MARGIN, BASE_BED_TRAVEL, NO_PROGRESS_MS, NO_PROGRESS_RADIUS, NO_PROGRESS_IDLE_RESET_MS, THREAT_IGNORE_MS, FAILED_HUNT_MS, BASE_UNREACHABLE_MS, SHELTER_BLOCKED_MS, DEATH_DROPS_MS, INVENTORY_DESYNC, COOKABLE, DEATH_DROPS_RANGE, DIG_ESCAPE_MS, GOTO_REJECTED_MOVES, UNREACHED_MOVE, PHYSICAL_PREPARATION_REFUSALS, NAVIGATION_POSITION_NOT_CONFIRMED, travelTimeoutMs, summarizeGatherRecovery, shadowObjectiveKey, protectPenBlocks }
