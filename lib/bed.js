// lib/bed.js
// Cama na base: 3 lãs da mesma cor (ovelha, ou 4 linhas = 1 lã branca) + 3 tábuas. Colocada perto da base, dormir nela
// atravessa a noite e usá-la (até de dia) faz da base o ponto de renascimento. Sem cama, cada morte de noite renascia no
// spawn sem nada e sem abrigo possível (r4: 23 de 28 mortes foram de noite).

const { Vec3 } = require('vec3')
const { craftItem } = require('./craft')

const BED_WOOL = 3
const STRING_PER_WOOL = 4
const BASE_BED_RANGE = 8
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const count = (bot, predicate) => bot.inventory.items().filter((i) => predicate(i.name)).reduce((n, i) => n + i.count, 0)

function bedItem(bot) {
  return bot.inventory.items().find((i) => i.name.endsWith('_bed')) || null
}

// Cor com mais lã no inventário (a receita exige 3 da mesma cor).
function bestWool(bot) {
  const byColor = {}
  for (const item of bot.inventory.items()) {
    if (item.name.endsWith('_wool')) byColor[item.name] = (byColor[item.name] || 0) + item.count
  }
  const [name, n] = Object.entries(byColor).sort((a, b) => b[1] - a[1])[0] || [null, 0]
  return { name, count: n }
}

// Lã utilizável numa cama contando a linha que vira lã branca.
function woolEquivalent(bot) {
  const wool = bestWool(bot)
  const fromString = Math.floor(count(bot, (n) => n === 'string') / STRING_PER_WOOL)
  return Math.max(wool.count, (wool.name === 'white_wool' ? wool.count : 0) + fromString)
}

function hasBedMaterials(bot) {
  return Boolean(bedItem(bot)) || woolEquivalent(bot) >= BED_WOOL
}

function bedBlockIds(bot) {
  return bot.registry.blocksArray.filter((b) => b.name.endsWith('_bed')).map((b) => b.id)
}

// Cama a até `range` blocos de `center` (só em chunks carregados; senão null).
function findBedNear(bot, center, range = BASE_BED_RANGE) {
  if (!center || typeof bot.findBlock !== 'function') return null
  return bot.findBlock({ point: new Vec3(center.x, center.y, center.z), matching: bedBlockIds(bot), maxDistance: range }) || null
}

// Fabrica a cama com o que tem: linha -> lã branca quando faltar lã, tábuas/mesa pelo craftItem existente.
async function craftBed(bot, isCancelled) {
  if (bedItem(bot)) return bedItem(bot)
  let wool = bestWool(bot)
  if (wool.count < BED_WOOL) {
    const missing = BED_WOOL - (wool.name === 'white_wool' ? wool.count : 0)
    await craftItem(bot, 'white_wool', missing, isCancelled)
    wool = bestWool(bot)
  }
  if (isCancelled()) return null
  if (wool.count < BED_WOOL) throw new Error(`lã insuficiente para a cama (${wool.count}/${BED_WOOL})`)
  await craftItem(bot, wool.name.replace(/_wool$/, '_bed'), 1, isCancelled)
  return bedItem(bot)
}

const air = (block) => block && ['air', 'cave_air'].includes(block.name)
const solid = (block) => block?.boundingBox === 'block'

// Duas células livres lado a lado com chão firme perto do bot (a cama ocupa 2 blocos na direção em que ele olha).
function bedSpots(bot) {
  const feet = bot.entity.position.floored()
  const spots = []
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (const dy of [0, -1, 1]) {
        const foot = feet.offset(dx, dy, dz)
        if (Math.abs(dx) + Math.abs(dz) < 2 && dy === 0) continue
        if (!air(bot.blockAt(foot)) || !air(bot.blockAt(foot.offset(0, 1, 0))) || !solid(bot.blockAt(foot.offset(0, -1, 0)))) continue
        for (const [hx, hz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const head = foot.offset(hx, 0, hz)
          if (head.equals(feet) || head.equals(feet.offset(0, 1, 0))) continue
          if (!air(bot.blockAt(head)) || !solid(bot.blockAt(head.offset(0, -1, 0)))) continue
          spots.push({ foot, head, dist: foot.distanceTo(feet) })
        }
      }
    }
  }
  return spots.sort((a, b) => a.dist - b.dist)
}

// Coloca a cama do inventário ao lado do bot; confirma no mundo.
async function placeBed(bot, isCancelled) {
  const ids = bedBlockIds(bot)
  let lastError = new Error('sem lugar para a cama')
  for (const { foot, head } of bedSpots(bot).slice(0, 6)) {
    if (isCancelled()) return null
    const item = bedItem(bot)
    if (!item) break
    try {
      await bot.equip(item, 'hand')
      // A cabeceira vai para onde o bot olha: olha da posição do pé para a da cabeça.
      await bot.lookAt(head.offset(0.5, 0, 0.5).plus(head.minus(foot).scaled(2)), true)
      await bot.placeBlock(bot.blockAt(foot.offset(0, -1, 0)), new Vec3(0, 1, 0))
    } catch (err) {
      lastError = err
    }
    await sleep(500)
    const placed = bot.blockAt(foot)
    if (placed && ids.includes(placed.type)) return placed
  }
  throw lastError
}

// Usa a cama: de noite dorme; de dia o servidor só registra o ponto de renascimento. Retorna 'dormi' | 'ponto' | null.
async function useBed(bot, bed, isCancelled) {
  try {
    await bot.sleep(bed)
  } catch (err) {
    // De dia o mineflayer recusa ('it\'s not night'), então ativa direto: no 1.20.1 isso registra o ponto de renascimento.
    await bot.activateBlock(bed).catch(() => {})
    return 'ponto'
  }
  while (bot.isSleeping && !isCancelled()) await sleep(1000)
  if (bot.isSleeping) await bot.wake().catch(() => {})
  return 'dormi'
}

module.exports = { BED_WOOL, bedItem, bestWool, woolEquivalent, hasBedMaterials, findBedNear, craftBed, placeBed, useBed, bedSpots }
