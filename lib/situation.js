// lib/situation.js
// "Onde estou?": junta posição, bioma, céu aberto ou não, tipo de ambiente,
// luz, perigos e lugares conhecidos numa resposta só.
//
// Só lê o mundo; nada aqui anda, cava ou decide.

const perception = require('./perception')
const { normalizeDimension } = require('./world-memory')

const ROOF_SCAN = 32
const BUILD_RADIUS = 4
const WALL_SCAN = 6
const LAVA_RANGE = 5
const DROP_SCAN = 6

const AIR = new Set(['air', 'cave_air', 'void_air'])
const FLUID = new Set(['water', 'lava', 'bubble_column'])
// Deixam a luz do céu passar (não contam como teto).
const SEE_THROUGH = (n) => AIR.has(n) || n === 'glass' || n.endsWith('_glass') || n.endsWith('_glass_pane') ||
  n === 'short_grass' || n === 'grass' || n === 'tall_grass' || n === 'fern' || n === 'large_fern' ||
  n === 'torch' || n === 'wall_torch' || n === 'vine' || n === 'snow' || n.endsWith('_sapling') || n.endsWith('_flower') ||
  n === 'dandelion' || n === 'poppy'
const TREE = (n) => n.endsWith('_leaves') || n.endsWith('_log') || n.endsWith('_wood')
// Blocos que quase só aparecem quando alguém constrói.
const ARTIFICIAL = (n) => n.endsWith('_planks') || n.endsWith('_door') || n.endsWith('_bed') || n.endsWith('_stairs') ||
  n.endsWith('_slab') || n.endsWith('_fence') || n.endsWith('_trapdoor') || n.endsWith('_wool') || n.endsWith('_carpet') ||
  n === 'glass' || n.endsWith('_glass') || n.endsWith('_glass_pane') || n === 'bricks' || n === 'stone_bricks' ||
  n === 'chest' || n === 'barrel' || n === 'crafting_table' || n === 'furnace' || n === 'torch' || n === 'wall_torch' ||
  n === 'lantern' || n === 'bookshelf'
const NATURAL_UNDERGROUND = (n) => n === 'stone' || n === 'deepslate' || n === 'tuff' || n === 'andesite' ||
  n === 'diorite' || n === 'granite' || n === 'gravel' || n.endsWith('_ore') || n === 'netherrack' || n === 'basalt' ||
  n === 'blackstone' || n === 'end_stone'

const nameAt = (bot, p) => bot.blockAt(p)?.name ?? null
const solid = (n) => n != null && !SEE_THROUGH(n) && !FLUID.has(n)
const round = (n) => Math.round(n)

function feetPos(bot) {
  const p = bot.entity.position
  return p.floored ? p.floored() : p.offset(0, 0, 0)
}

// Primeiro bloco que tampa o céu acima da cabeça (distância e nome), ou null se céu aberto.
function roofAbove(bot, feet) {
  const top = Number.isFinite(bot.game?.height) && Number.isFinite(bot.game?.minY) ? bot.game.minY + bot.game.height : 320
  for (let dy = 2; dy <= ROOF_SCAN && feet.y + dy < top; dy++) {
    const n = nameAt(bot, feet.offset(0, dy, 0))
    if (n == null) return null // chunk sem dados: não dá para afirmar teto
    if (!SEE_THROUGH(n)) return { distance: dy, name: n }
  }
  return null
}

// Quantos dos 4 lados têm parede sólida perto (na altura do corpo).
function wallsAround(bot, feet) {
  let walls = 0
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let d = 1; d <= WALL_SCAN; d++) {
      if (solid(nameAt(bot, feet.offset(dx * d, 1, dz * d)))) { walls++; break }
    }
  }
  return walls
}

// Contagem de blocos artificiais, naturais de subsolo e ar num cubo pequeno.
function surroundings(bot, feet, r = BUILD_RADIUS) {
  const c = { artificial: 0, underground: 0, air: 0, total: 0 }
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -1; dy <= 3; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        const n = nameAt(bot, feet.offset(dx, dy, dz))
        if (n == null) continue
        c.total++
        if (AIR.has(n)) c.air++
        else if (ARTIFICIAL(n)) c.artificial++
        else if (NATURAL_UNDERGROUND(n)) c.underground++
      }
    }
  }
  return c
}

function biomeName(bot, feet) {
  const b = bot.blockAt(feet)?.biome
  const name = b?.name ?? (typeof b === 'string' ? b : null)
  if (name) return String(name).replace(/^minecraft:/, '')
  const id = b?.id
  return Number.isFinite(id) && bot.registry?.biomes?.[id]?.name ? bot.registry.biomes[id].name : null
}

function lightAt(bot, feet) {
  const b = bot.blockAt(feet)
  const block = Number.isFinite(b?.light) ? b.light : null
  const sky = Number.isFinite(b?.skyLight) ? b.skyLight : null
  return { block, sky }
}

function isNight(bot) {
  const t = bot.time?.timeOfDay
  return Number.isFinite(t) ? t >= 13000 && t < 23000 : null
}

// Camada de altura, só no overworld.
function layerOf(dim, y) {
  if (dim !== 'overworld') return null
  if (y < 0) return 'deepslate'
  if (y < 50) return 'subsolo'
  if (y > 100) return 'montanha'
  return 'superficie'
}

// Classifica o ambiente a partir das pistas (pura, fácil de testar).
function classify({ inLava, inWater, roof, walls, around }) {
  if (inLava) return 'lava'
  if (inWater) return 'agua'
  if (!roof) return 'ar_livre'
  if (TREE(roof.name) && roof.distance <= 12) return 'sob_arvore'
  if (around.artificial >= 6 && walls >= 3 && roof.distance <= 6) return 'construcao'
  if (around.underground >= around.artificial * 3 && around.underground > 0) {
    return around.air >= 40 ? 'caverna' : 'tunel'
  }
  if (around.artificial >= 3) return 'construcao'
  return 'coberto'
}

function dropUnder(bot, feet) {
  for (let d = 1; d <= DROP_SCAN; d++) {
    const n = nameAt(bot, feet.offset(0, -d, 0))
    if (n == null || !AIR.has(n)) return d - 1
  }
  return DROP_SCAN
}

function dangers(bot, feet, { inLava, night, light, env }) {
  const out = []
  if (inLava) out.push('estou na lava')
  const lavaId = bot.registry?.blocksByName?.lava?.id
  if (lavaId != null && typeof bot.findBlocks === 'function') {
    const lava = (bot.findBlocks({ matching: lavaId, maxDistance: LAVA_RANGE, count: 1 }) || [])[0]
    if (lava && !inLava) out.push(`lava a ${round(lava.distanceTo(bot.entity.position))} (${perception.direction(bot.entity.position, lava)})`)
  }
  const drop = dropUnder(bot, feet)
  if (drop >= 3) out.push(`queda de ${drop >= DROP_SCAN ? `${DROP_SCAN}+` : drop} blocos embaixo`)
  for (const t of perception.threats(bot).filter((t) => t.urgent).slice(0, 2)) {
    out.push(`${t.name} a ${round(t.distance)} (${t.direction})`)
  }
  // Mobs nascem com luz de bloco 0; ao ar livre só à noite.
  if (light.block === 0 && (env !== 'ar_livre' || night === true)) out.push('escuro: mobs podem nascer')
  return out
}

function nearestWaypoint(bot, waypoints, dim) {
  const list = typeof waypoints?.list === 'function' ? waypoints.list() : Array.isArray(waypoints) ? waypoints : []
  const pos = bot.entity.position
  let best = null
  for (const w of list) {
    if (!w?.position) continue
    if (w.dimension && normalizeDimension(w.dimension) !== dim) continue
    const d = Math.hypot(w.position.x - pos.x, w.position.y - pos.y, w.position.z - pos.z)
    if (!best || d < best.distance) best = { name: w.name, distance: d, direction: perception.direction(pos, w.position) }
  }
  return best
}

// Resumo completo de onde o bot está. `worldMemory` e `waypoints` são opcionais.
function whereAmI(bot, { worldMemory = null, waypoints = null } = {}) {
  if (!bot?.entity?.position) return null
  const pos = bot.entity.position
  const feet = feetPos(bot)
  const dim = normalizeDimension(bot.game?.dimension) || 'overworld'
  const inLava = bot.entity.isInLava === true || nameAt(bot, feet) === 'lava'
  const inWater = !inLava && (bot.entity.isInWater === true || nameAt(bot, feet.offset(0, 1, 0)) === 'water')
  const roof = roofAbove(bot, feet)
  const light = lightAt(bot, feet)
  const night = isNight(bot)
  const around = surroundings(bot, feet)
  const walls = wallsAround(bot, feet)
  const env = classify({ inLava, inWater, roof, walls, around })
  const explored = worldMemory?.exploredInfo?.(dim, pos) || null

  return {
    dim,
    pos: { x: round(pos.x), y: round(pos.y), z: round(pos.z) },
    biome: biomeName(bot, feet),
    layer: layerOf(dim, pos.y),
    env,
    openSky: !roof,
    roof,
    walls,
    light,
    night,
    under: perception.blockUnderFeet(bot),
    facing: perception.facing(bot),
    dangers: dangers(bot, feet, { inLava, night, light, env }),
    nearest: nearestWaypoint(bot, waypoints, dim),
    visits: explored ? explored.n : 0
  }
}

const ENV_TEXT = {
  ar_livre: 'ao ar livre', sob_arvore: 'debaixo de árvore', construcao: 'dentro de uma construção',
  caverna: 'numa caverna', tunel: 'num túnel', coberto: 'num lugar coberto', agua: 'na água', lava: 'na lava'
}

// Linhas curtas para o chat (limite de 256 caracteres por mensagem).
function describeSituation(s) {
  if (!s) return ['Ainda não estou no mundo.']
  const where = [`${s.pos.x} ${s.pos.y} ${s.pos.z}`, s.dim]
  if (s.biome) where.push(s.biome)
  if (s.layer) where.push(s.layer)
  const lines = [`Estou em ${where.join(', ')}. ${ENV_TEXT[s.env] || s.env}${s.roof && s.env !== 'ar_livre' ? ` (teto a ${s.roof.distance})` : ''}.`]
  const extra = [`pisando em ${s.under}`]
  if (s.facing) extra.push(`virado para ${s.facing}`)
  if (s.light.block != null || s.light.sky != null) extra.push(`luz ${s.light.block ?? '?'}/${s.light.sky ?? '?'} (bloco/céu)`)
  if (s.night != null) extra.push(s.night ? 'noite' : 'dia')
  lines.push(extra.join(', '))
  if (s.nearest) lines.push(`Mais perto: ${s.nearest.name} a ${round(s.nearest.distance)} blocos (${s.nearest.direction})${s.visits > 1 ? `; já passei aqui ${s.visits}x` : ''}`)
  else if (s.visits > 1) lines.push(`Já passei por aqui ${s.visits}x.`)
  lines.push(s.dangers.length ? `Perigo: ${s.dangers.join('; ')}` : 'Sem perigo à vista.')
  return lines.map((l) => l.slice(0, 256))
}

module.exports = { whereAmI, describeSituation, classify, layerOf, roofAbove, wallsAround, surroundings, ENV_TEXT }
