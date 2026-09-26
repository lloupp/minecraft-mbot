// lib/night.js
// Passar a noite em segurança: dormir numa cama por perto ou, sem cama, cavar
// um buraco de 3 blocos, tampar por cima e esperar o dia.

const { goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const { goTo } = require('./food')

const BED_RANGE = 32
const DIG_DEPTH = 3
const NIGHT_START = 12542 // a partir daqui dá para dormir e monstros aparecem
const NIGHT_END = 23460
const LIQUIDS = new Set(['water', 'lava', 'bubble_column'])
const AIRS = new Set(['air', 'cave_air', 'void_air'])
const UNDIGGABLE = new Set(['bedrock', 'barrier', 'obsidian', 'crying_obsidian', 'reinforced_deepslate'])
// Blocos que caem (areia, cascalho) ou atrapalham: não servem de tampa.
const COVER_BLOCKS = ['dirt', 'cobblestone', 'cobbled_deepslate', 'stone', 'deepslate', 'netherrack',
  'andesite', 'diorite', 'granite', 'tuff', 'coarse_dirt', 'rooted_dirt', 'mud', 'blackstone']

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function isNight(bot) {
  const t = bot.time?.timeOfDay
  return typeof t === 'number' && t >= NIGHT_START && t < NIGHT_END
}

function findBed(bot) {
  const ids = bot.registry.blocksArray.filter((b) => b.name.endsWith('_bed')).map((b) => b.id)
  return bot.findBlock({ matching: ids, maxDistance: BED_RANGE })
}

// Dorme até amanhecer (ou até cancelar). Lança erro se não der para deitar
// (monstros por perto, cama ocupada...).
async function sleepInBed(bot, bed, isCancelled) {
  await goTo(bot, new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2))
  if (isCancelled()) return false
  await bot.sleep(bot.blockAt(bed.position))
  while (bot.isSleeping && !isCancelled()) await sleep(1000)
  if (bot.isSleeping) await bot.wake().catch(() => {})
  return true
}

const blockName = (bot, pos) => bot.blockAt(pos)?.name
const isSolid = (block) => block?.boundingBox === 'block' && !LIQUIDS.has(block.name)

// Dá para cavar DIG_DEPTH blocos para baixo a partir de `ground` (bloco sob os
// pés) sem cair em caverna nem abrir passagem para água/lava?
function safeToDig(bot, ground) {
  for (let d = 0; d < DIG_DEPTH; d++) {
    const pos = ground.offset(0, -d, 0)
    const block = bot.blockAt(pos)
    if (!isSolid(block) || UNDIGGABLE.has(block.name)) return false
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const side = blockName(bot, pos.offset(x, 0, z))
      if (!side || LIQUIDS.has(side) || AIRS.has(side)) return false
    }
  }
  const floor = bot.blockAt(ground.offset(0, -DIG_DEPTH, 0))
  return isSolid(floor)
}

// Lugar seguro para o buraco, perto do bot.
function findShelterSpot(bot) {
  const feet = bot.entity.position.floored()
  for (let r = 0; r <= 8; r++) {
    for (let x = -r; x <= r; x++) {
      for (let z = -r; z <= r; z++) {
        if (Math.max(Math.abs(x), Math.abs(z)) !== r) continue
        const ground = feet.offset(x, -1, z)
        const above = bot.blockAt(ground.offset(0, 1, 0))
        if (AIRS.has(above?.name) && safeToDig(bot, ground)) return ground
      }
    }
  }
  return null
}

function coverItem(bot) {
  return bot.inventory.items().find((i) => COVER_BLOCKS.includes(i.name))
}

// Os blocos cavados caem no buraco e só entram no inventário ~0,5 s depois
// (visto no 1.20.1: desistia com "não tenho bloco" e segundos depois tinha 5 terras).
async function waitForCoverItem(bot, timeoutMs = 2000) {
  for (let waited = 0; ; waited += 100) {
    const item = coverItem(bot)
    if (item || waited >= timeoutMs) return item || null
    await sleep(100)
  }
}

// Cava o buraco sob `ground`, desce e tampa a entrada. Retorna a posição da tampa.
async function digShelter(bot, ground, isCancelled) {
  const top = ground.offset(0, 1, 0)
  console.log(`[noite] abrigo em ${top} (bot em ${bot.entity.position.floored()})`)
  if (!bot.entity.position.floored().equals(top)) {
    await goTo(bot, new goals.GoalBlock(top.x, top.y, top.z), 15000)
  }
  for (let d = 0; d < DIG_DEPTH; d++) {
    if (isCancelled()) return null
    const pos = ground.offset(0, -d, 0)
    const block = bot.blockAt(pos)
    if (!AIRS.has(block?.name)) {
      const tool = bot.pathfinder.bestHarvestTool(block)
      if (tool) await bot.equip(tool, 'hand')
      console.log(`[noite] cavando ${block.name} em ${pos}`)
      await bot.dig(block)
    }
    // Espera cair no buraco.
    for (let i = 0; i < 20 && bot.entity.position.y > pos.y + 0.1; i++) await sleep(100)
  }
  if (isCancelled()) return null
  const item = await waitForCoverItem(bot)
  if (!item) throw new Error('não tenho bloco para tampar o abrigo')
  // A tampa vai no nível do chão original, encostada num bloco da parede.
  const lid = ground
  const wall = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([x, z]) => bot.blockAt(lid.offset(x, 0, z)))
    .find(isSolid)
  if (!wall) throw new Error('sem parede para apoiar a tampa')
  await bot.equip(item, 'hand')
  await bot.placeBlock(wall, lid.minus(wall.position))
  return lid
}

// Sai do buraco para um bloco vizinho na superfície.
async function leaveShelter(bot, lid, surface) {
  const block = bot.blockAt(lid)
  if (block && !AIRS.has(block.name)) await bot.dig(block)

  const exits = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([x, z]) => surface.offset(x, 0, z))
    .filter((p) => isSolid(bot.blockAt(p.offset(0, -1, 0))) &&
      AIRS.has(blockName(bot, p)) && AIRS.has(blockName(bot, p.offset(0, 1, 0))))

  for (const exit of exits.length ? exits : [surface]) {
    await goTo(bot, new goals.GoalBlock(exit.x, exit.y, exit.z), 20000).catch(() => {})
    if (bot.entity.position.y >= surface.y - 0.2) return true
  }
  return false
}

// Passa a noite: cama se houver; senão abrigo cavado. `onShelter(bool)` avisa
// quando o bot está protegido (para os reflexos não saírem para lutar).
async function spendNight(bot, isCancelled, { onShelter = () => {}, say = () => {} } = {}) {
  const bed = findBed(bot)
  if (bed) {
    try {
      say('Vou dormir.')
      await sleepInBed(bot, bed, isCancelled)
      return 'dormi'
    } catch (err) {
      console.log(`Não consegui dormir: ${err.message}`)
    }
  }
  if (isCancelled()) return null
  const spot = findShelterSpot(bot)
  if (!spot) throw new Error('não achei lugar seguro para cavar um abrigo')
  const surface = spot.offset(0, 1, 0)
  say('Vou me abrigar até amanhecer.')
  const lid = await digShelter(bot, spot, isCancelled)
  if (!lid) return null
  onShelter(true)
  try {
    while (isNight(bot) && !isCancelled()) await sleep(2000)
  } finally {
    onShelter(false)
  }
  if (isCancelled()) return null
  if (!(await leaveShelter(bot, lid, surface))) throw new Error('não consegui sair do abrigo')
  return 'abrigo'
}

module.exports = { isNight, findBed, spendNight, findShelterSpot, safeToDig, waitForCoverItem, NIGHT_START, NIGHT_END }
