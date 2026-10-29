// lib/perception.js
// Reconhecer o ambiente: blocos (onde pisa, para onde olha, recursos por perto)
// e entidades (mobs hostis, animais, jogadores), com distância e direção.
//
// Só lê o mundo; nada aqui anda, cava ou decide.

const RESOURCE_RANGE = 16
const ENTITY_RANGE = 24
const DANGER_RANGE = 8

const NOTABLE = new Set([
  'chest', 'barrel', 'crafting_table', 'furnace', 'blast_furnace', 'smoker', 'water', 'lava',
  'wheat', 'carrots', 'potatoes', 'beetroots', 'sweet_berry_bush', 'melon', 'pumpkin', 'sugar_cane',
  'spawner', 'obsidian', 'nether_portal', 'ancient_debris', 'bell', 'composter', 'hay_block'
])

// Blocos que interessam a um jogador ao olhar em volta.
function isNotable(name) {
  return name.endsWith('_log') || name.endsWith('_ore') || name.endsWith('_bed') || NOTABLE.has(name)
}

// Mobs que exigem reação imediata mesmo longe do alcance de ataque.
const URGENT = new Set(['creeper', 'warden', 'witch', 'skeleton', 'stray', 'blaze', 'ghast', 'evoker', 'ravager'])

// Direção cardeal de `from` para `to` (no Minecraft, norte = -Z e leste = +X).
const DIRS = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO']
function direction(from, to) {
  const dx = to.x - from.x
  const dz = to.z - from.z
  if (Math.abs(dx) < 0.5 && Math.abs(dz) < 0.5) return 'aqui'
  const angle = Math.atan2(dx, -dz) // 0 = norte, sentido horário
  const i = Math.round(angle / (Math.PI / 4))
  return DIRS[((i % 8) + 8) % 8]
}

// Para onde o bot está virado (yaw do mineflayer: 0 = norte, cresce para oeste).
function facing(bot) {
  const yaw = bot?.entity?.yaw
  if (!Number.isFinite(yaw)) return null
  const from = { x: 0, z: 0 }
  return direction(from, { x: -Math.sin(yaw), z: -Math.cos(yaw) })
}

const round = (n) => Math.round(n)

// Contagem por nome + o mais próximo de cada um.
function nearbyBlocks(bot, range = RESOURCE_RANGE) {
  return Object.fromEntries(Object.entries(nearbyBlockDetails(bot, range)).map(([name, d]) => [name, d.count]))
}

function nearbyBlockDetails(bot, range = RESOURCE_RANGE) {
  const origin = bot?.entity?.position
  if (!origin || typeof bot.findBlocks !== 'function' || !bot.registry?.blocksArray) return {}
  const ids = bot.registry.blocksArray.filter((b) => isNotable(b.name)).map((b) => b.id)
  if (!ids.length) return {}
  const out = {}
  for (const pos of bot.findBlocks({ matching: ids, maxDistance: range, count: 500 }) || []) {
    const name = bot.blockAt(pos)?.name
    if (!name) continue
    const dist = pos.distanceTo(origin)
    const entry = out[name] || (out[name] = { count: 0, nearest: null, distance: Infinity, direction: null })
    entry.count++
    if (dist < entry.distance) {
      entry.distance = dist
      entry.nearest = pos
      entry.direction = direction(origin, pos)
    }
  }
  return out
}

function entityGroup(e) {
  if (e.type === 'player') return 'player'
  if (e.type === 'hostile') return 'hostile'
  if (e.type === 'animal' || e.type === 'passive' || e.type === 'water_creature' || e.type === 'ambient') return 'animal'
  return null
}

// Entidades por perto, cada uma com distância e direção, do mais próximo ao mais distante.
function nearbyEntityList(bot, range = ENTITY_RANGE) {
  const origin = bot?.entity?.position
  if (!origin) return []
  const out = []
  for (const e of Object.values(bot.entities || {})) {
    if (!e || e === bot.entity || !e.position) continue
    const group = entityGroup(e)
    if (!group) continue
    const distance = e.position.distanceTo(origin)
    if (distance > range) continue
    out.push({ group, name: e.username || e.name || '?', distance, direction: direction(origin, e.position), entity: e })
  }
  return out.sort((a, b) => a.distance - b.distance)
}

// Formato antigo: { hostile: {nome: n}, animal: {...}, player: {...} }.
function nearbyEntities(bot, range = ENTITY_RANGE) {
  const groups = { hostile: {}, animal: {}, player: {} }
  for (const e of nearbyEntityList(bot, range)) groups[e.group][e.name] = (groups[e.group][e.name] || 0) + 1
  return groups
}

// Ameaças ordenadas por urgência: perto primeiro, mobs perigosos à distância também contam.
function threats(bot, range = ENTITY_RANGE) {
  return nearbyEntityList(bot, range)
    .filter((e) => e.group === 'hostile')
    .map((e) => ({ ...e, urgent: e.distance <= DANGER_RANGE || (URGENT.has(e.name) && e.distance <= 16) }))
    .sort((a, b) => (b.urgent - a.urgent) || (a.distance - b.distance))
}

function blockUnderFeet(bot) {
  const pos = bot?.entity?.position
  return pos ? bot.blockAt(pos.offset(0, -1, 0))?.name ?? '?' : '?'
}

function lookingAt(bot) {
  try { return bot.blockAtCursor?.(6)?.name ?? 'nada' } catch { return 'nada' }
}

const fmt = (counts, max = 6) => Object.entries(counts)
  .sort((a, b) => b[1] - a[1]).slice(0, max)
  .map(([name, n]) => `${name}x${n}`).join(', ') || 'nada'

const fmtBlocks = (details, max = 6) => Object.entries(details)
  .sort((a, b) => a[1].distance - b[1].distance).slice(0, max)
  .map(([name, d]) => `${name}x${d.count}(${round(d.distance)}${d.direction})`).join(', ') || 'nada'

const fmtEntities = (list, max = 5) => {
  const seen = new Map()
  for (const e of list) {
    const s = seen.get(e.name)
    if (s) s.n++
    else seen.set(e.name, { n: 1, distance: e.distance, direction: e.direction })
  }
  return [...seen.entries()].slice(0, max)
    .map(([name, s]) => `${name}${s.n > 1 ? `x${s.n}` : ''}(${round(s.distance)}${s.direction})`).join(', ') || 'nada'
}

// Linhas curtas para o chat (limite de 256 caracteres por mensagem).
function describe(bot) {
  if (!bot?.entity) return ['Ainda não estou no mundo.']
  const face = facing(bot)
  const ents = nearbyEntityList(bot)
  const hostile = threats(bot)
  const lines = [
    `Pisando em: ${blockUnderFeet(bot)} | Olhando para: ${lookingAt(bot)}${face ? ` (virado para ${face})` : ''}`,
    `Perto (${RESOURCE_RANGE} blocos): ${fmtBlocks(nearbyBlockDetails(bot))}`,
    `Hostis: ${fmtEntities(hostile)} | Animais: ${fmtEntities(ents.filter((e) => e.group === 'animal'))}`
  ]
  const players = ents.filter((e) => e.group === 'player')
  if (players.length) lines.push(`Jogadores: ${fmtEntities(players)}`)
  if (hostile.some((e) => e.urgent)) lines.push(`Atenção: ${hostile.filter((e) => e.urgent).map((e) => `${e.name} a ${round(e.distance)} (${e.direction})`).slice(0, 3).join(', ')}`)
  return lines.map((l) => l.slice(0, 256))
}

module.exports = {
  describe, nearbyBlocks, nearbyBlockDetails, nearbyEntities, nearbyEntityList, threats,
  direction, facing, blockUnderFeet, lookingAt, isNotable, fmt
}
