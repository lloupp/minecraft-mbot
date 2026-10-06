// lib/world-observer.js
// Ponte percepção -> WorldMemory. Lê o mundo real (mineflayer) de forma limitada e
// resume em poucos registros (nunca um por bloco). Também RECONCILIA: confere no mundo
// real se uma lembrança ainda vale e a confirma ou invalida.
//
// Nada aqui anda, cava ou decide; só observa e escreve conhecimento.

const { Vec3 } = require('vec3')
const { normalizeDimension, chunkOf, STATUS } = require('./world-memory')

const SCAN_RADIUS = 24
const AIR = new Set(['air', 'cave_air', 'void_air'])
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const MAX_REGIONS_PER_KIND = 4

const isLog = (n) => n.endsWith('_log') || n.endsWith('_stem')
const KIND_MATCHERS = {
  wood: isLog,
  stone: (n) => n === 'stone' || n === 'cobblestone' || n === 'deepslate' || n === 'andesite' || n === 'diorite' || n === 'granite',
  iron: (n) => n === 'iron_ore' || n === 'deepslate_iron_ore',
  coal: (n) => n === 'coal_ore' || n === 'deepslate_coal_ore',
  crafting_table: (n) => n === 'crafting_table',
  lava: (n) => n === 'lava'
}

// Nome de recurso/bloco -> tipo da memória (null = não rastreado).
function resourceKindForBlock(name) {
  for (const kind of ['wood', 'iron', 'coal', 'stone']) if (KIND_MATCHERS[kind](name)) return kind
  return null
}

function dimensionOf(bot) { return normalizeDimension(bot?.game?.dimension) }

function idsFor(bot, predicate) {
  return (bot.registry?.blocksArray || []).filter((b) => predicate(b.name)).map((b) => b.id)
}

function exposed(bot, p) {
  return SIDES.some(([x, y, z]) => AIR.has(bot.blockAt(p.offset(x, y, z))?.name))
}

// Agrupa posições por chunk, devolvendo {anchor (mais próxima do bot), count}.
const FOOD_ANIMALS = new Set(['cow', 'pig', 'sheep', 'chicken', 'rabbit', 'mooshroom'])

function clusterByChunk(positions, origin) {
  const by = new Map()
  for (const p of positions) {
    const k = `${chunkOf(p.x)},${chunkOf(p.z)}`
    const c = by.get(k) || { count: 0, anchor: p, d: Infinity }
    c.count++
    const d = p.distanceTo(origin)
    if (d < c.d) { c.d = d; c.anchor = p }
    by.set(k, c)
  }
  return [...by.values()].sort((a, b) => a.d - b.d)
}

function findKind(bot, kind, { count, maxDistance = SCAN_RADIUS, point = undefined }) {
  const ids = idsFor(bot, KIND_MATCHERS[kind])
  if (!ids.length) return []
  return bot.findBlocks({ matching: ids, maxDistance, count, ...(point ? { point } : {}) }) || []
}

// Observa os arredores e atualiza a memória. Devolve um resumo curto (para log/teste).
function observeSurroundings(bot, memory, { by = null, radius = SCAN_RADIUS } = {}) {
  const origin = bot?.entity?.position
  if (!memory || !origin || typeof bot.findBlocks !== 'function') return null
  const dim = dimensionOf(bot)
  const summary = { dim, newChunks: 0, found: {} }
  if (memory.visit(dim, origin)) summary.newChunks++

  for (const kind of ['wood', 'iron', 'coal']) {
    const found = clusterByChunk(findKind(bot, kind, { count: 32, maxDistance: radius }), origin).filter((c) => c.count >= (kind === 'wood' ? 2 : 1))
    for (const c of found.slice(0, MAX_REGIONS_PER_KIND)) memory.discover(kind, dim, c.anchor, { count: c.count, by })
    if (found.length) summary.found[kind] = Math.min(found.length, MAX_REGIONS_PER_KIND)
  }

  // Pedra só vale quando exposta (alcançável sem túnel); enterrada é ruído.
  const stones = findKind(bot, 'stone', { count: 64, maxDistance: radius }).filter((p) => exposed(bot, p))
  const stoneRegions = clusterByChunk(stones, origin).filter((c) => c.count >= 3)
  for (const c of stoneRegions.slice(0, MAX_REGIONS_PER_KIND)) memory.discover('stone', dim, c.anchor, { count: c.count, by })
  if (stoneRegions.length) summary.found.stone = Math.min(stoneRegions.length, MAX_REGIONS_PER_KIND)

  // Animais de comida vistos (entidades rastreadas pelo cliente, que podem estar além do alcance de caça): rebanho por
  // chunk. Só conhecimento; ir até lá e caçar continua sendo confirmado no mundo real.
  const animals = Object.values(bot.entities || {})
    .filter((e) => FOOD_ANIMALS.has(e?.name) && e.position && e !== bot.entity)
    .map((e) => e.position.floored())
  for (const c of clusterByChunk(animals, origin).slice(0, MAX_REGIONS_PER_KIND)) {
    memory.discover('food', dim, c.anchor, { count: c.count, by })
    summary.found.food = (summary.found.food || 0) + 1
  }

  for (const p of findKind(bot, 'crafting_table', { count: 4, maxDistance: radius })) {
    memory.discover('crafting_table', dim, p, { by })
    summary.found.crafting_table = (summary.found.crafting_table || 0) + 1
  }

  for (const c of clusterByChunk(findKind(bot, 'lava', { count: 16, maxDistance: 16 }), origin).slice(0, 2)) {
    memory.markHazard('lava', dim, c.anchor, { by })
    summary.found.lava = (summary.found.lava || 0) + 1
  }

  const entry = detectMineEntry(bot, origin)
  if (entry) { memory.discover('mine_entry', dim, entry, { by }); summary.found.mine_entry = 1 }

  summary.reconciled = reconcile(bot, memory, { radius: 12, by })
  const fresh = memory.takeNewChunks()
  if (fresh) memory.log(`explored +${fresh} chunk(s) at (${Math.floor(origin.x)},${Math.floor(origin.z)}) total=${memory.exploredCount(dim)}`)
  return summary
}

// Entrada de mina/caverna: ar de caverna gerado (cave_air) com abertura a poucos blocos do bot.
// Heurística deliberadamente simples (landmark, não entendimento de caverna).
function detectMineEntry(bot, origin) {
  const id = bot.registry?.blocksByName?.cave_air?.id
  if (!Number.isInteger(id)) return null
  const cave = bot.findBlocks({ matching: id, maxDistance: 16, count: 24 }) || []
  if (cave.length < 8) return null
  const near = cave.filter((p) => Math.abs(p.y - origin.y) <= 8).sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin))
  return near[0] || null
}

// Confere lembranças perto do bot contra o mundo real. Só mexe no que o bot consegue ver agora
// (chunk carregado e dentro do raio): mesa -> bloco exato; região -> ainda existe o recurso?
function reconcile(bot, memory, { radius = 12, by = null } = {}) {
  const origin = bot?.entity?.position
  if (!origin) return { confirmed: 0, invalidated: 0 }
  const dim = dimensionOf(bot)
  const result = { confirmed: 0, invalidated: 0 }
  for (const p of [...memory.places.values()]) {
    if (p.dim !== dim || p.status === STATUS.INVALIDATED) continue
    const matcher = KIND_MATCHERS[p.kind]
    if (!matcher) continue // mine_entry/hazards: só decaem por validade
    const d = Math.hypot(p.x - origin.x, p.z - origin.z)
    if (d > radius) continue
    if (!verifyPlace(bot, memory, p, { by, result })) continue
  }
  return result
}

// Verifica uma lembrança no mundo real. Devolve true se a verificação foi conclusiva.
function verifyPlace(bot, memory, place, { by = null, result = null } = {}) {
  const matcher = KIND_MATCHERS[place.kind]
  if (!matcher) return false
  const pos = new Vec3(place.x, place.y, place.z)
  const block = bot.blockAt(pos)
  if (!block) return false // chunk não carregado: inconclusivo
  let present
  if (place.kind === 'crafting_table') {
    present = matcher(block.name)
  } else {
    // Região: o recurso pode ter sido cortado/minerado. Procura outro do mesmo tipo em volta da âncora.
    present = matcher(block.name) || findKind(bot, place.kind, { count: 1, maxDistance: 8, point: pos }).length > 0
  }
  if (present) { memory.confirm(place.key, { by }); if (result) result.confirmed++ } else {
    memory.invalidate(place.key, place.kind === 'crafting_table' ? `now=${block.name}` : 'exhausted')
    if (result) result.invalidated++
  }
  return true
}

module.exports = { observeSurroundings, reconcile, verifyPlace, resourceKindForBlock, dimensionOf, KIND_MATCHERS, SCAN_RADIUS }
