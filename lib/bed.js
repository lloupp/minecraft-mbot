// lib/bed.js
// Cama na base: 3 lãs da mesma cor (ovelha, ou 4 linhas = 1 lã branca) + 3 tábuas. Colocada perto da base, dormir nela
// atravessa a noite e usá-la (até de dia) faz da base o ponto de renascimento. Sem cama, cada morte de noite renascia no
// spawn sem nada e sem abrigo possível (r4: 23 de 28 mortes foram de noite).

const { Vec3 } = require('vec3')
const { goals } = require('mineflayer-pathfinder')
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
    // Uma lã por vez: no 1.20.1, bot.craft com várias repetições na grade 2x2 do inventário consumiu 11 linhas e
    // entregou 1 lã (o resto ficou preso na grade). Visto no Minecraft.
    const white = () => count(bot, (n) => n === 'white_wool')
    while (white() < BED_WOOL && count(bot, (n) => n === 'string') >= STRING_PER_WOOL && !isCancelled()) {
      const before = white()
      await craftItem(bot, 'white_wool', before + 1, isCancelled)
      for (let i = 0; i < 20 && white() <= before; i++) await sleep(100)
      if (white() <= before) break
    }
    wool = bestWool(bot)
  }
  if (isCancelled()) return null
  if (wool.count < BED_WOOL) throw new Error(`lã insuficiente para a cama (${wool.count}/${BED_WOOL})`)
  await craftItem(bot, wool.name.replace(/_wool$/, '_bed'), 1, isCancelled)
  return bedItem(bot)
}

const air = (block) => block && ['air', 'cave_air'].includes(block.name)
const solid = (block) => block?.boundingBox === 'block'

// Duas células livres lado a lado com chão firme perto do bot. O placeBlock do mineflayer olha para o ponto clicado e o
// servidor põe a cabeceira na direção em que o bot olha: cabeceira = pé + direção cardinal do bot até o pé.
function bedSpots(bot) {
  const feet = bot.entity.position.floored()
  const spots = []
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) === Math.abs(dz)) continue // diagonal: direção ambígua
      for (const dy of [0, -1, 1]) {
        const foot = feet.offset(dx, dy, dz)
        const step = Math.abs(dx) > Math.abs(dz) ? [Math.sign(dx), 0] : [0, Math.sign(dz)]
        const head = foot.offset(step[0], 0, step[1])
        if (!air(bot.blockAt(foot)) || !air(bot.blockAt(foot.offset(0, 1, 0))) || !solid(bot.blockAt(foot.offset(0, -1, 0)))) continue
        if (!air(bot.blockAt(head)) || !air(bot.blockAt(head.offset(0, 1, 0))) || !solid(bot.blockAt(head.offset(0, -1, 0)))) continue
        spots.push({ foot, head, dist: foot.distanceTo(feet) })
      }
    }
  }
  return spots.sort((a, b) => a.dist - b.dist)
}

// Coloca a cama do inventário perto do bot; confirma no mundo.
async function placeBed(bot, isCancelled) {
  const ids = bedBlockIds(bot)
  let lastError = new Error('sem lugar para a cama')
  for (const { foot } of bedSpots(bot).slice(0, 6)) {
    if (isCancelled()) return null
    const item = bedItem(bot)
    if (!item) break
    try {
      await bot.equip(item, 'hand')
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

// Cor da lã de uma ovelha (metadado 17 no 1.20.1: cor nos 4 bits baixos, 0x10 = tosquiada e não dá lã). O servidor
// não envia o campo com o valor padrão: ausente = branca (visto no Minecraft: cinza tinha 17 = 7, branca não tinha 17).
const WOOL_COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan',
  'purple', 'blue', 'brown', 'green', 'red', 'black']
function sheepWool(entity) {
  if (!entity?.metadata) return 'unknown'
  const raw = entity.metadata[17] == null ? 0 : Number(entity.metadata[17])
  if (!Number.isFinite(raw)) return 'unknown'
  if (raw & 0x10) return null
  return `${WOOL_COLORS[raw & 0x0f]}_wool`
}

// Lã que ainda serve para a cama: a cor com mais unidades, contando a linha como lã branca. Sem nenhuma: qualquer cor.
function wantedWool(bot) {
  const byColor = {}
  for (const item of bot.inventory.items()) {
    if (item.name.endsWith('_wool')) byColor[item.name] = (byColor[item.name] || 0) + item.count
  }
  byColor.white_wool = (byColor.white_wool || 0) + Math.floor(count(bot, (n) => n === 'string') / STRING_PER_WOOL)
  const [name, n] = Object.entries(byColor).sort((a, b) => b[1] - a[1] || (a[0] === 'white_wool' ? -1 : 1))[0]
  return n > 0 ? name : null
}

// Cama não é segura no Nether/End: usar lá explode o bloco.
function bedSafeDimension(bot) {
  const dimension = String(bot?.game?.dimension?.name || bot?.game?.dimension || '').toLowerCase()
  return !dimension.includes('nether') && !dimension.includes('end')
}

// Ovelha que ainda pode dar a lã que falta. Sem nenhuma lã no inventário,
// aceita qualquer cor; com lã parcial, procura a mesma cor para fechar as 3.
function findWoolSheep(bot, range = 48) {
  const position = bot.entity?.position
  if (!position || typeof bot.nearestEntity !== 'function') return null
  const target = wantedWool(bot)
  const usable = (entity) => {
    if (entity?.name !== 'sheep' || entity.isValid === false) return false
    if (!entity.position || entity.position.distanceTo(position) > range) return false
    const wool = sheepWool(entity)
    return wool !== null && (!target || wool === 'unknown' || wool === target)
  }
  return bot.nearestEntity(usable) || null
}

// Procura ovelhas para a lã em pontos próximos, em vez de esperar que uma
// apareça no meio de uma tarefa de mineração. Só é usada de dia.
async function searchSheep(bot, isCancelled, { range = 48, tries = 4 } = {}) {
  for (let i = 0; i < tries && !isCancelled(); i++) {
    const sheep = findWoolSheep(bot, range)
    if (sheep) return sheep
    const position = bot.entity.position
    const seen = [...new Set(Object.values(bot.entities || {})
      .filter((e) => e !== bot.entity && e.position && e.position.distanceTo(position) <= range && e.name)
      .map((e) => e.name))].slice(0, 12)
    console.log(`[cama] procurando ovelha (${wantedWool(bot) || 'qualquer cor'}); perto: ${seen.join(', ') || 'nada'}`)
    const angle = Math.random() * Math.PI * 2
    const distance = 32 + Math.random() * 24
    const target = position.offset(Math.cos(angle) * distance, 0, Math.sin(angle) * distance)
    await require('./food').goTo(bot, new goals.GoalXZ(Math.round(target.x), Math.round(target.z)), 15000).catch(() => {})
    if (isCancelled()) return null
    await sleep(800)
  }
  return findWoolSheep(bot, range)
}

// Garante uma cama utilizável: usa a que já está perto, senão obtém lã (se
// permitido), fabrica e coloca. Retorna o bloco da cama ou null se cancelado.
async function ensureBed(bot, isCancelled, { allowHunt = true, range = 48, log = () => {}, say = () => {} } = {}) {
  if (!bedSafeDimension(bot)) throw new Error('cama não é segura nesta dimensão')
  const near = findBedNear(bot, bot.entity?.position, BASE_BED_RANGE)
  if (near) return near

  if (!hasBedMaterials(bot)) {
    if (!allowHunt) throw new Error('sem material para a cama')
    let sheep = findWoolSheep(bot, range)
    if (!sheep) {
      say('Vou procurar ovelhas para a lã.')
      sheep = await searchSheep(bot, isCancelled, { range })
    }
    if (!sheep) throw new Error('não achei ovelha para tirar lã')
    say('Vou pegar lã para fazer uma cama.')
    // Uma ovelha por vez; para quando fechar 3 lãs da mesma cor ou quando a
    // caça não render nada (ovelha fugiu, outro jogador pegou o drop etc.).
    for (let hunts = 0; sheep && hunts < 4 && !hasBedMaterials(bot) && !isCancelled(); hunts++) {
      const before = woolEquivalent(bot)
      await require('./food').hunt(bot, sheep, isCancelled)
      if (isCancelled()) return null
      if (woolEquivalent(bot) <= before) break
      sheep = findWoolSheep(bot, range)
    }
    if (!hasBedMaterials(bot)) throw new Error(`lã insuficiente para a cama (${woolEquivalent(bot)}/${BED_WOOL})`)
  }

  say('Vou fabricar uma cama.')
  const item = await craftBed(bot, isCancelled)
  if (!item || isCancelled()) return null
  say('Vou colocar a cama.')
  const bed = await placeBed(bot, isCancelled)
  log(`[cama] colocada em ${bed.position}`)
  return bed
}

module.exports = { BED_WOOL, WOOL_COLORS, sheepWool, wantedWool, bedItem, bestWool, woolEquivalent, hasBedMaterials, findBedNear, craftBed, placeBed, useBed, bedSpots, bedSafeDimension, findWoolSheep, ensureBed }
