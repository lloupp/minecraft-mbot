// lib/failure.js
// Taxonomia única de falha. O mesmo código precisa significar a mesma coisa no
// chat, no evento, no MissionStore e no relatório — e a recuperação recomendada
// depende do código, não do texto da mensagem.

'use strict'

const CODES = Object.freeze({
  PATH_NO_PATH: 'PATH_NO_PATH',
  PATH_TIMEOUT: 'PATH_TIMEOUT',
  PATH_STUCK: 'PATH_STUCK',
  PATH_DIG_ERROR: 'PATH_DIG_ERROR',
  PATH_PLACE_ERROR: 'PATH_PLACE_ERROR',
  PATH_NO_SCAFFOLD: 'PATH_NO_SCAFFOLD',
  PROTECTED_AREA: 'PROTECTED_AREA',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_UNREACHABLE: 'RESOURCE_UNREACHABLE',
  CHUNK_UNLOADED: 'CHUNK_UNLOADED',
  TOOL_MISSING: 'TOOL_MISSING',
  FOOD_MISSING: 'FOOD_MISSING',
  INVENTORY_FULL: 'INVENTORY_FULL',
  CONTAINER_UNREACHABLE: 'CONTAINER_UNREACHABLE',
  CONTAINER_FULL: 'CONTAINER_FULL',
  NOT_SPAWNED: 'NOT_SPAWNED',
  DEAD: 'DEAD',
  WRONG_DIMENSION: 'WRONG_DIMENSION',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  CANCELLED: 'CANCELLED',
  INTERRUPTED: 'INTERRUPTED',
  UNKNOWN: 'UNKNOWN'
})

const RETRYABLE = new Set([
  CODES.PATH_TIMEOUT,
  CODES.PATH_STUCK,
  CODES.PATH_DIG_ERROR,
  CODES.PATH_NO_SCAFFOLD,
  CODES.PATH_NO_PATH,
  CODES.RESOURCE_UNREACHABLE,
  CODES.TOOL_MISSING,
  CODES.FOOD_MISSING,
  CODES.INVENTORY_FULL,
  CODES.CONTAINER_FULL,
  CODES.CONTAINER_UNREACHABLE,
  CODES.CHUNK_UNLOADED
])

const ACTIONS = Object.freeze({
  [CODES.PATH_NO_PATH]: 'alternate_target',
  [CODES.PATH_TIMEOUT]: 'split_route',
  [CODES.PATH_STUCK]: 'unstick',
  [CODES.PATH_DIG_ERROR]: 'retry',
  [CODES.PATH_PLACE_ERROR]: 'abort',
  [CODES.PATH_NO_SCAFFOLD]: 'retry',
  [CODES.PROTECTED_AREA]: 'abort',
  [CODES.RESOURCE_NOT_FOUND]: 'alternate_target',
  [CODES.RESOURCE_UNREACHABLE]: 'alternate_target',
  [CODES.CHUNK_UNLOADED]: 'retry',
  [CODES.TOOL_MISSING]: 'withdraw_tool',
  [CODES.FOOD_MISSING]: 'eat',
  [CODES.INVENTORY_FULL]: 'free_slots',
  [CODES.CONTAINER_UNREACHABLE]: 'retry',
  [CODES.CONTAINER_FULL]: 'retry',
  [CODES.NOT_SPAWNED]: 'retry',
  [CODES.DEAD]: 'abort',
  [CODES.WRONG_DIMENSION]: 'abort',
  [CODES.VERIFICATION_FAILED]: 'abort',
  [CODES.CANCELLED]: 'abort',
  [CODES.INTERRUPTED]: 'abort',
  [CODES.UNKNOWN]: 'abort'
})

// Códigos já usados por lib/gather.js.
const COLLECTION_CODES = Object.freeze({
  RESOURCE_NOT_FOUND: CODES.RESOURCE_NOT_FOUND,
  RESOURCE_UNREACHABLE: CODES.RESOURCE_UNREACHABLE,
  PATH_FAILED: CODES.PATH_NO_PATH,
  DIG_FAILED: CODES.PATH_DIG_ERROR,
  ITEM_NOT_CONFIRMED: CODES.VERIFICATION_FAILED,
  INVENTORY_FULL: CODES.INVENTORY_FULL,
  TARGET_BLOCKED: CODES.RESOURCE_UNREACHABLE,
  NO_EXPECTED_DROPS: CODES.VERIFICATION_FAILED,
  CANCELLED: CODES.CANCELLED
})

const MESSAGE_RULES = [
  [/chunk.*(n[aã]o|sem).*carregad|unloaded chunk/i, CODES.CHUNK_UNLOADED],
  [/blockupdate.*timeout|did not fire within timeout|coloca[cç][aã]o.*(falh|recus)|prote[cç][aã]o/i, CODES.PROTECTED_AREA],
  [/destination full|chest.*full|container.*full|ba[uú] cheio/i, CODES.CONTAINER_FULL],
  [/caminho demorou demais|path.*time[d ]?out|took too long|timed out/i, CODES.PATH_TIMEOUT],
  [/fora do alcance|unreachable|cannot reach|n[aã]o consegui chegar/i, CODES.RESOURCE_UNREACHABLE],
  [/sem picareta|picareta.*(falt|ausente)|tool.*missing|ferramenta.*(falt|ausente)/i, CODES.TOOL_MISSING],
  [/sem comida|fome|food.*(missing|low)|hungry/i, CODES.FOOD_MISSING],
  [/mochila cheia|inventory.*full|sem espa[cç]o/i, CODES.INVENTORY_FULL],
  [/dimens[aã]o|dimension/i, CODES.WRONG_DIMENSION]
]

function result(code, detail) {
  const known = Object.values(CODES).includes(code) ? code : CODES.UNKNOWN
  return {
    code: known,
    detail: detail == null ? null : String(detail),
    retryable: RETRYABLE.has(known),
    action: ACTIONS[known] || 'abort'
  }
}

function classify({ error, code, nav } = {}) {
  if (code && Object.values(CODES).includes(code)) return result(code, error?.message || error)
  if (code && COLLECTION_CODES[code]) return result(COLLECTION_CODES[code], error?.message || error)
  if (nav?.code) return result(nav.code, nav.reason || nav.code)

  const message = String(error?.message || error || '')
  if (!message) return result(CODES.UNKNOWN, null)
  for (const [pattern, mapped] of MESSAGE_RULES) {
    if (pattern.test(message)) return result(mapped, message)
  }
  return result(CODES.UNKNOWN, message)
}

function retryable(code) {
  return RETRYABLE.has(code)
}

function actionFor(code) {
  return ACTIONS[code] || 'abort'
}

module.exports = { CODES, RETRYABLE, ACTIONS, classify, retryable, actionFor }
