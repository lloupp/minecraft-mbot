// lib/handover.js
// Entregar itens do bot ao dono. O destino padrão é um baú combinado
// (DELIVERY_CHEST); a entrega na mão continua disponível para quando o dono
// está por perto. Nada é creditado como entregue sem sair da mochila.

const { goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const { withItemLock } = require('./item-lock')

const GIVE_RANGE = 2.5      // perto o bastante para o jogador pegar o drop
const WALK_MS = 25000       // teto de caminhada até ele
const CONTAINER_NAMES = new Set(['chest', 'trapped_chest', 'barrel'])
// Ponto combinado com o dono para as entregas.
const DELIVERY_CHEST = Object.freeze({ x: -241, y: 64, z: -11 })

// Nomes que o dono costuma digitar -> nome do item no registro.
const ALIASES = {
  lapis: 'lapis_lazuli',
  'lápis': 'lapis_lazuli',
  lapislazuli: 'lapis_lazuli',
  'lapis-lazuli': 'lapis_lazuli',
  ferro: 'iron_ingot',
  ouro: 'gold_ingot',
  carvao: 'coal',
  'carvão': 'coal',
  madeira: 'oak_log',
  pedra: 'cobblestone',
  bolo: 'cake'
}

function normalizeItem(wanted) {
  const raw = String(wanted ?? '').trim().toLowerCase()
  if (!raw) return ''
  if (ALIASES[raw]) return ALIASES[raw]
  return raw.replace(/\s+/g, '_')
}

// Separa das pilhas do inventário quanto será entregue, respeitando o que existe.
function planHandover(items, name, amount) {
  const body = []
  let left = Math.max(0, Number(amount) || 0)
  for (const item of items || []) {
    if (left <= 0) break
    if (!item || item.name !== name) continue
    const take = Math.min(item.count, left)
    if (take > 0) {
      body.push({ type: item.type, name: item.name, count: take })
      left -= take
    }
  }
  return { plan: body, missing: left }
}

const countOf = (bot, name) => bot.inventory.items()
  .filter((item) => item.name === name)
  .reduce((sum, item) => sum + item.count, 0)

function positionOf(entry) {
  const raw = entry?.position || entry || {}
  const x = Number(raw.x)
  const y = Number(raw.y)
  const z = Number(raw.z)
  if (![x, y, z].every(Number.isFinite)) return null
  return { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) }
}

// Baú/barrel mais próximo do ponto combinado (o dono pode ter posto ao lado).
function findContainer(bot, center, radius = 3) {
  const at = positionOf(center)
  if (!at) return null
  const target = new Vec3(at.x, at.y, at.z)
  let best = null
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const block = bot.blockAt?.(target.offset(dx, dy, dz))
        if (!block || !CONTAINER_NAMES.has(block.name)) continue
        const distance = block.position.distanceTo(target)
        if (!best || distance < best.distance) best = { block, distance }
      }
    }
  }
  return best?.block || null
}

async function goToBlock(bot, block, range = 2) {
  const position = block.position
  const goal = new goals.GoalNear(position.x, position.y, position.z, range)
  const timeout = new Promise((resolve) => setTimeout(() => resolve('tarde'), WALK_MS))
  const moved = await Promise.race([bot.pathfinder.goto(goal).then(() => 'ok', () => 'falhou'), timeout])
  if (moved === 'ok') return true
  if (moved === 'tarde') bot.pathfinder.setGoal?.(null)
  const here = bot.entity?.position
  return Boolean(here) && here.distanceTo(position) <= range + 2
}

// Caminha até o jogador; sem caminho, devolve false em vez de insistir.
async function approachOwner(bot, owner) {
  const from = bot.entity?.position
  const at = positionOf(owner)
  if (!from || !at) return false
  const target = new Vec3(at.x, at.y, at.z)
  if (from.distanceTo(target) <= GIVE_RANGE) return true
  const goal = new goals.GoalNear(at.x, at.y, at.z, GIVE_RANGE - 0.5)
  const timeout = new Promise((resolve) => setTimeout(() => resolve('tarde'), WALK_MS))
  const moved = await Promise.race([bot.pathfinder.goto(goal).then(() => 'ok', () => 'falhou'), timeout])
  if (moved === 'ok') return true
  if (moved === 'tarde') bot.pathfinder.setGoal?.(null)
  return bot.entity.position.distanceTo(target) <= GIVE_RANGE + 1
}

// Entrega `amount` de `name` na mão do jogador.
async function deliverTo(bot, { owner, name, amount, isCancelled = () => false } = {}) {
  const item = normalizeItem(name)
  if (!item) return { ok: false, delivered: 0, reason: 'item não informado' }
  if (!owner?.position) return { ok: false, delivered: 0, reason: 'não vejo você por perto' }
  const { plan, missing } = planHandover(bot.inventory.items(), item, amount)
  if (!plan.length) return { ok: false, delivered: 0, reason: `não tenho ${item}`, missing }

  const arrived = await approachOwner(bot, owner)
  if (isCancelled()) return { ok: false, delivered: 0, cancelled: true }
  if (!arrived) return { ok: false, delivered: 0, reason: 'não consegui chegar até você' }

  return withItemLock(bot, async () => {
    const before = countOf(bot, item)
    try { await bot.lookAt(owner.position.offset(0, 1, 0), true) } catch { /* mira é conforto */ }
    for (const entry of plan) {
      if (isCancelled()) break
      try {
        await bot.toss(entry.type, null, entry.count)
      } catch (err) {
        return { ok: false, delivered: before - countOf(bot, item), reason: `não consegui jogar: ${err.message}` }
      }
    }
    // Confirma na mochila: o drop só é entrega se saiu de verdade.
    for (let waited = 0; waited < 1500 && countOf(bot, item) >= before; waited += 150) {
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    const remaining = countOf(bot, item)
    return { ok: before - remaining > 0, delivered: before - remaining, remaining, missing }
  })
}

// Lugares planos e seguros para o baú, do mais perto para o mais longe.
function findPlaceSpots(bot, at, radius = 3) {
  const center = new Vec3(at.x, at.y, at.z)
  const unsafe = /^(lava|water|flowing_lava|flowing_water|fire|soul_fire|magma_block|cactus|powder_snow)$/
  const spots = []
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const pos = center.offset(dx, dy, dz)
        const floor = bot.blockAt?.(pos.offset(0, -1, 0))
        const here = bot.blockAt?.(pos)
        const above = bot.blockAt?.(pos.offset(0, 1, 0))
        if (!floor || !here || !above) continue
        if (floor.boundingBox !== 'block' || unsafe.test(floor.name)) continue
        if (here.boundingBox !== 'empty' || above.boundingBox !== 'empty') continue
        spots.push({ pos, floor, distance: pos.distanceTo(center) })
      }
    }
  }
  return spots.sort((a, b) => a.distance - b.distance)
}

function findPlaceSpot(bot, at, radius = 3) {
  return findPlaceSpots(bot, at, radius)[0] || null
}

// Deixa um baú na mochila: usa o que tem, senão pega material no estoque e
// fabrica. Precisa rodar ANTES de caminhar até o ponto de entrega, porque o
// estoque central fica longe do destino.
async function prepareChestItem(bot, { withdraw = null, craftItem = null, isCancelled = () => false, log = () => {} } = {}) {
  const has = () => bot.inventory.items().some((item) => item.name === 'chest')
  if (has()) return true
  if (typeof withdraw === 'function') {
    for (const material of ['oak_planks', 'oak_log']) {
      if (bot.inventory.items().some((item) => item.name.endsWith('_planks') || item.name.endsWith('_log'))) break
      const got = await withdraw(material, 8).catch(() => 0)
      if (got) log(`[entrega] peguei ${got}x ${material} do estoque`)
    }
  }
  if (typeof craftItem === 'function') {
    try {
      await craftItem(bot, 'chest', 1, isCancelled)
    } catch (err) {
      log(`[entrega] fabricar baú: ${err.message}`)
    }
  }
  return has()
}

// Garante baú no endereço: usa o que existe, senão fabrica e coloca um.
async function ensureChest(bot, at, { isCancelled = () => false, craftItem = null, withdraw = null, log = () => {} } = {}) {
  const existing = findContainer(bot, at)
  if (existing) return { block: existing, created: false }
  let chest = bot.inventory.items().find((item) => item.name === 'chest') || null
  // Sem baú: pega tábuas/troncos do estoque antes de sair coletando madeira.
  if (!chest && typeof withdraw === 'function') {
    for (const material of ['oak_planks', 'oak_log']) {
      if (bot.inventory.items().some((item) => item.name.endsWith('_planks') || item.name.endsWith('_log'))) break
      const got = await withdraw(material, 8).catch(() => 0)
      if (got) log(`[entrega] peguei ${got}x ${material} do estoque`)
    }
  }
  if (!chest && typeof craftItem === 'function') {
    try {
      await craftItem(bot, 'chest', 1, isCancelled)
    } catch (err) {
      log(`[entrega] fabricar baú: ${err.message}`)
    }
    chest = bot.inventory.items().find((item) => item.name === 'chest') || null
  }
  if (!chest) return { block: null, created: false, reason: 'não tenho baú (nem tábuas) para colocar' }
  // Alguns servidores não confirmam o blockUpdate na hora: tenta outros pontos
  // e confere por leitura antes de desistir.
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  for (let attempt = 0; attempt < 3; attempt++) {
    const spot = findPlaceSpot(bot, at, 3 + attempt)
    if (!spot) break
    try {
      await bot.equip(chest, 'hand')
      await bot.placeBlock(spot.floor, new Vec3(0, 1, 0))
    } catch (err) {
      log(`[entrega] colocar baú (tentativa ${attempt + 1}): ${err.message}`)
    }
    for (let waited = 0; waited < 3000; waited += 300) {
      const found = findContainer(bot, at) || (bot.blockAt?.(spot.pos)?.name === 'chest' ? bot.blockAt(spot.pos) : null)
      if (found) return { block: found, created: true, position: positionOf(found.position) }
      if (!bot.inventory.items().some((item) => item.name === 'chest')) break
      await sleep(300)
    }
    if (!bot.inventory.items().some((item) => item.name === 'chest')) {
      return { block: null, created: false, reason: 'o baú saiu da mochila mas não apareceu no mundo' }
    }
  }
  return { block: null, created: false, reason: 'o baú não apareceu depois de colocar' }
}

// Entrega no baú combinado, criando-o se faltar. Confirma nas duas pontas:
// saiu da mochila e apareceu no contêiner.
async function depositAtChest(bot, {
  position = DELIVERY_CHEST, name, amount, isCancelled = () => false,
  craftItem = null, withdraw = null, allowCreate = true, log = () => {}
} = {}) {
  const item = normalizeItem(name)
  const at = positionOf(position)
  if (!item) return { ok: false, deposited: 0, reason: 'item não informado' }
  if (!at) return { ok: false, deposited: 0, reason: 'endereço de entrega inválido' }
  const label = `${at.x}, ${at.y}, ${at.z}`
  const { plan, missing } = planHandover(bot.inventory.items(), item, amount)
  if (!plan.length) return { ok: false, deposited: 0, reason: `não tenho ${item}`, missing }

  const reached = await goToBlock(bot, { position: new Vec3(at.x, at.y, at.z) })
  if (isCancelled()) return { ok: false, deposited: 0, cancelled: true }

  return withItemLock(bot, async () => {
    let block = findContainer(bot, at)
    let created = false
    if (!block && allowCreate) {
      const made = await ensureChest(bot, at, { isCancelled, craftItem, withdraw, log })
      block = made.block
      created = Boolean(made.created)
      if (!block) return { ok: false, deposited: 0, reason: made.reason || `não achei baú em ${label}`, missing, position: at }
    }
    if (!block) return { ok: false, deposited: 0, reason: `não achei baú em ${label}`, missing, position: at }
    if (!reached && !(await goToBlock(bot, block))) {
      return { ok: false, deposited: 0, reason: `não consegui chegar ao baú em ${label}`, chest: positionOf(block.position) }
    }
    const before = countOf(bot, item)
    let container
    try {
      container = await bot.openContainer(block)
    } catch (err) {
      return { ok: false, deposited: 0, reason: `não abri o baú: ${err.message}`, chest: positionOf(block.position) }
    }
    try {
      for (const entry of plan) {
        if (isCancelled()) break
        await container.deposit(entry.type, null, entry.count).catch(() => {})
      }
      const inside = (container.containerItems?.() || [])
        .filter((entry) => entry.name === item)
        .reduce((sum, entry) => sum + entry.count, 0)
      for (let waited = 0; waited < 1500 && countOf(bot, item) >= before; waited += 150) {
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
      const after = countOf(bot, item)
      return {
        ok: before - after > 0,
        deposited: before - after,
        remaining: after,
        inside,
        missing,
        created,
        chest: positionOf(block.position)
      }
    } finally {
      try { container.close() } catch { /* janela já fechada */ }
    }
  })
}

// Último recurso quando o servidor recusa contêiner: derruba no chão mesmo.
async function dropItems(bot, { name, amount, isCancelled = () => false } = {}) {
  const item = normalizeItem(name)
  if (!item) return { dropped: 0, reason: 'item não informado' }
  const { plan, missing } = planHandover(bot.inventory.items(), item, amount)
  if (!plan.length) return { dropped: 0, reason: `não tenho ${item}`, missing }
  const before = countOf(bot, item)
  return withItemLock(bot, async () => {
    for (const entry of plan) {
      if (isCancelled()) break
      await bot.toss(entry.type, null, entry.count).catch((err) => {
        void err
      })
    }
    for (let waited = 0; waited < 1500 && countOf(bot, item) >= before; waited += 150) {
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    const after = countOf(bot, item)
    return { dropped: before - after, remaining: after, missing }
  })
}

// Cria um baú NOVO perto (não reaproveita contêiner existente). Serve para o
// caso em que o baú antigo já está cheio: bolo não empilha, cada um ocupa slot.
async function createChestAt(bot, at, { radius = 4, craftItem = null, withdraw = null, isCancelled = () => false, log = () => {} } = {}) {
  const center = positionOf(at)
  if (!center) return { block: null, created: false, reason: 'endereço inválido' }
  if (!(await prepareChestItem(bot, { withdraw, craftItem, isCancelled, log }))) {
    return { block: null, created: false, reason: 'não tenho baú (nem tábuas) para colocar' }
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const spots = findPlaceSpots(bot, center, radius + 2)
  let attempt = 0
  for (const spot of spots) {
    attempt++
    // Não empilha baú em cima de outro contêiner.
    if (findContainer(bot, positionOf(spot.pos), 2)) continue
    const chest = bot.inventory.items().find((item) => item.name === 'chest')
    if (!chest) break
    try {
      await bot.equip(chest, 'hand')
      await bot.placeBlock(spot.floor, new Vec3(0, 1, 0))
    } catch (err) {
      log(`[báu] colocar (tentativa ${attempt + 1}): ${err.message}`)
    }
    for (let waited = 0; waited < 3000; waited += 300) {
      const block = bot.blockAt?.(spot.pos)
      if (block?.name === 'chest') {
        return { block, created: true, position: positionOf(block.position) }
      }
      await sleep(300)
    }
  }
  return { block: null, created: false, reason: 'não consegui colocar o baú novo' }
}

module.exports = {
  deliverTo, depositAtChest, ensureChest, createChestAt, prepareChestItem, findContainer, findPlaceSpot, planHandover,
  normalizeItem, approachOwner, positionOf, dropItems, DELIVERY_CHEST, GIVE_RANGE
}
