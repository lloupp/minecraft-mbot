// lib/night.js
// Passar a noite em segurança: dormir numa cama por perto ou, sem cama, cavar
// um buraco de 3 blocos, tampar por cima e esperar o dia.

const pathfinderLib = require('mineflayer-pathfinder')
const { goals } = pathfinderLib
const { Vec3 } = require('vec3')
const { goTo } = require('./food')

const BED_RANGE = 32
const DIG_DEPTH = 3
const SHELTER_SEARCH_DEPTH = 32
// Raio da busca de lugar para o abrigo. Com 8, depois de renascer no spawn sem picareta não havia lugar: num raio de 8
// quase tudo é pedra (sem picareta não dá tampa) e a terra começa entre 8 e 16 (medido no mundo novo). O explorador
// passava a noite exposto e morria (linha de base: 56 de 105 mortes de noite, desarmado).
const SHELTER_RADIUS = 16
const SHELTER_SPOT_TRIES = 3
const SHELTER_SEARCH_UP = 6
const NIGHT_START = 12542 // a partir daqui dá para dormir e monstros aparecem
const NIGHT_END = 23460
// Anoitecer: a partir daqui o player loop já trata como noite para entrar no abrigo antes dos monstros. Visto no
// Minecraft: as mortes de noite vinham cedo (hora 14400–18300), fugindo de monstros antes de o abrigo ficar pronto.
const DUSK = 12000
const LIQUIDS = new Set(['water', 'lava', 'bubble_column'])
const AIRS = new Set(['air', 'cave_air', 'void_air'])
const UNDIGGABLE = new Set(['bedrock', 'barrier', 'obsidian', 'crying_obsidian', 'reinforced_deepslate'])
// Blocos que caem (areia, cascalho) ou atrapalham: não servem de tampa.
const COVER_BLOCKS = ['dirt', 'cobblestone', 'cobbled_deepslate', 'stone', 'deepslate', 'netherrack',
  'andesite', 'diorite', 'granite', 'tuff', 'coarse_dirt', 'rooted_dirt', 'mud', 'blackstone']
// A superfície precisa produzir um bloco utilizável como tampa. Árvores têm
// colisão sólida, mas folhas e troncos não são uma base segura para o abrigo.
const SHELTER_SURFACE_BLOCKS = new Set([...COVER_BLOCKS, 'grass_block'])
// Chão natural: abaixo dele não há outra superfície (folhas e troncos de árvore não contam: embaixo pode haver chão).
const TERRAIN = new Set([...SHELTER_SURFACE_BLOCKS, 'sand', 'red_sand', 'gravel', 'sandstone', 'red_sandstone', 'clay',
  'podzol', 'mycelium', 'snow_block', 'terracotta', 'calcite', 'dripstone_block', 'moss_block'])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Noite para decidir abrigo: do anoitecer ao amanhecer.
function nightFalling(bot) {
  const t = bot.time?.timeOfDay
  return typeof t === 'number' && t >= DUSK && t < NIGHT_END
}

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
  // Chegou ao anoitecer: só dá para deitar a partir de NIGHT_START (~27 s depois).
  while (bot.time?.timeOfDay < NIGHT_START && !isCancelled()) await sleep(1000)
  if (isCancelled()) return false
  await bot.sleep(bot.blockAt(bed.position))
  while (bot.isSleeping && !isCancelled()) await sleep(1000)
  if (bot.isSleeping) await bot.wake().catch(() => {})
  return true
}

const blockName = (bot, pos) => bot.blockAt(pos)?.name
// Dá para ocupar: ar, grama alta, flores, neve fina (sem colisão e sem líquido).
const isPassable = (block) => Boolean(block) && block.boundingBox === 'empty' && !LIQUIDS.has(block.name)
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

// Lugar seguro para o buraco, perto do bot (o mais próximo primeiro).
function findShelterSpot(bot) {
  return findShelterSpots(bot, 1)[0] || null
}

// Até `limit` lugares, do mais próximo ao mais distante (um por anel).
function findShelterSpots(bot, limit = SHELTER_SPOT_TRIES) {
  const feet = bot.entity.position.floored()
  const spots = []
  ring: for (let r = 0; r <= SHELTER_RADIUS && spots.length < limit; r++) {
    for (let x = -r; x <= r; x++) {
      for (let z = -r; z <= r; z++) {
        if (Math.max(Math.abs(x), Math.abs(z)) !== r) continue
        // Começa acima dos pés: perto do spawn a terra fica em morros mais altos que o bot (y 63 junto à água) e a busca
        // só para baixo não a via (visto no Minecraft: só pedra e água no alcance, nenhum abrigo de noite).
        for (let depth = -SHELTER_SEARCH_UP; depth <= SHELTER_SEARCH_DEPTH; depth++) {
          const ground = feet.offset(x, -1 - depth, z)
          const surface = bot.blockAt(ground)
          const above = bot.blockAt(ground.offset(0, 1, 0))
          if (SHELTER_SURFACE_BLOCKS.has(surface?.name) && isPassable(above) && safeToDig(bot, ground) && coverObtainable(bot, ground)) {
            spots.push(ground)
            continue ring // um por anel: o próximo vem de um anel mais distante
          }
          // Primeira superfície da coluna (sólida ou líquida com espaço livre em cima) recusada: mais fundo só há blocos
          // cobertos. Sem isto, o raio 16 descia 32 blocos em cada uma das ~1000 colunas a cada decisão noturna.
          if ((TERRAIN.has(surface?.name) || LIQUIDS.has(surface?.name)) && isPassable(above)) break
        }
      }
    }
  }
  return spots
}

// A tampa e a saída saem do próprio buraco: terra/grama caem com a mão; pedra só com picareta. Para sair de manhã o bot
// sobe empilhando DIG_DEPTH blocos, então o buraco (mais o que ele já carrega) precisa render pelo menos isso. Visto no
// Minecraft: sem picareta, cavou 3 de pedra e não tampou; depois, grama+terra+pedra deu 2 blocos e ele ficou preso no
// buraco de manhã ('não consegui sair do abrigo').
const HAND_COVER = new Set(['dirt', 'grass_block', 'coarse_dirt', 'rooted_dirt', 'mud'])
function coverObtainable(bot, ground) {
  const pickaxe = bot.inventory.items().some((i) => i.name.endsWith('_pickaxe'))
  let blocks = coverCount(bot)
  for (let d = 0; d < DIG_DEPTH; d++) {
    const name = bot.blockAt(ground.offset(0, -d, 0))?.name
    if (HAND_COVER.has(name) || (pickaxe && COVER_BLOCKS.includes(name))) blocks++
  }
  return blocks >= DIG_DEPTH
}

const coverCount = (bot) => bot.inventory.items().filter((i) => COVER_BLOCKS.includes(i.name)).reduce((n, i) => n + i.count, 0)

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
    await goTo(bot, new goals.GoalBlock(top.x, top.y, top.z), 25000)
    // O goto do pathfinder pode resolver sem chegar (caminho parcial vazio). Visto no Minecraft: cavou 3 blocos a 5 de
    // distância, os blocos não vieram e o abrigo ficou sem tampa. Sem estar em cima do buraco, não cava.
    const here = bot.entity.position
    if (Math.abs(here.x - (top.x + 0.5)) > 0.8 || Math.abs(here.z - (top.z + 0.5)) > 0.8 || Math.abs(here.y - top.y) > 1.2) {
      throw new Error('não cheguei ao lugar do abrigo')
    }
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
  try {
    await bot.placeBlock(wall, lid.minus(wall.position))
  } catch (err) {
    // Visto no Minecraft: 'Server refused to place dirt ... still air' com o bot ainda caindo no buraco. Espera
    // pousar e tenta mais uma vez.
    for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(100)
    await sleep(300)
    if (isCancelled()) return null
    await bot.placeBlock(wall, lid.minus(wall.position))
  }
  return lid
}

// Sai do buraco para um bloco vizinho na superfície.
async function leaveShelter(bot, lid, surface) {
  const block = bot.blockAt(lid)
  if (block && !AIRS.has(block.name)) {
    // Subir 3 blocos empilhando exige 3 blocos; a tampa cavada é o terceiro e cai no buraco ~0,5 s depois. Visto no
    // Minecraft: começava a subir antes de pegá-la e ficava a um bloco da saída ('não consegui sair do abrigo').
    const before = coverCount(bot)
    // Tampa de pedra/pedregulho só cai com picareta: com a mão some e faltava um bloco para subir. Visto no Minecraft:
    // abrigo em pedra na base, saiu com 2 pedregulhos de 3 e ficou no fundo ('não consegui sair do abrigo').
    const tool = bot.pathfinder?.bestHarvestTool?.(block)
    if (tool) await bot.equip(tool, 'hand').catch(() => {})
    await bot.dig(block)
    for (let waited = 0; waited < 2000 && coverCount(bot) <= before; waited += 100) await sleep(100)
  }

  const exits = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([x, z]) => surface.offset(x, 0, z))
    .filter((p) => isSolid(bot.blockAt(p.offset(0, -1, 0))) &&
      isPassable(bot.blockAt(p)) && isPassable(bot.blockAt(p.offset(0, 1, 0))))

  for (const exit of exits.length ? exits : [surface]) {
    await goTo(bot, new goals.GoalBlock(exit.x, exit.y, exit.z), 20000).catch(() => {})
    if (bot.entity.position.y >= surface.y - 0.2) return true
  }
  // Sem blocos para subir empilhando (ou caminho recusado): sai cavando uma escada. Visto no Minecraft: 6 vezes
  // 'não consegui sair do abrigo' e o explorador ficava preso no buraco de dia.
  const previous = bot.pathfinder.movements
  try {
    if (typeof bot.pathfinder.setMovements !== 'function') return false
    const dig = new pathfinderLib.Movements(bot)
    dig.canDig = true
    dig.allow1by1towers = true
    dig.allowParkour = false
    bot.pathfinder.setMovements(dig)
    await goTo(bot, new goals.GoalNear(surface.x, surface.y, surface.z, 2), 60000).catch(() => {})
  } finally {
    if (previous) bot.pathfinder.setMovements(previous)
  }
  return bot.entity.position.y >= surface.y - 0.2
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
  const spots = findShelterSpots(bot)
  if (!spots.length) throw new Error('não achei lugar seguro para cavar um abrigo')
  say('Vou me abrigar até amanhecer.')
  // Não chegou ao lugar (caminho recusado/expirado): tenta o próximo. Visto no Minecraft: 8 de 19 falhas de abrigo.
  let lid = null
  let spot = null
  for (let i = 0; i < spots.length; i++) {
    spot = spots[i]
    try {
      lid = await digShelter(bot, spot, isCancelled)
      break
    } catch (err) {
      if (i === spots.length - 1 || isCancelled() || !/não cheguei|caminho demorou|No path|Took to long/.test(err.message)) throw err
      console.log(`[noite] abrigo em ${spot}: ${err.message}; tentando outro lugar`)
    }
  }
  if (!lid) return null
  const surface = spot.offset(0, 1, 0)
  onShelter(true)
  try {
    while (nightFalling(bot) && !isCancelled()) await sleep(2000)
  } finally {
    onShelter(false)
  }
  if (isCancelled()) return null
  // Uma segunda tentativa antes de desistir, e o contexto no log para achar a causa (rodada 5: saiu com 6 pedregulhos
  // na mochila e ainda assim falhou, sem reprodução no teste dirigido).
  if (!(await leaveShelter(bot, lid, surface)) && !(await leaveShelter(bot, lid, surface))) {
    const here = bot.entity?.position
    console.log(`[noite] não saiu: bot em ${here?.floored?.()} superfície ${surface} blocos=${coverCount(bot)} ` +
      `tampa=${bot.blockAt(lid)?.name} vizinhos=${[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, z]) => bot.blockAt(surface.offset(x, 0, z))?.name).join(',')}`)
    throw new Error('não consegui sair do abrigo')
  }
  return 'abrigo'
}

module.exports = { isNight, nightFalling, findBed, spendNight, findShelterSpot, findShelterSpots, safeToDig, waitForCoverItem, digShelter, leaveShelter, NIGHT_START, NIGHT_END, DUSK }
