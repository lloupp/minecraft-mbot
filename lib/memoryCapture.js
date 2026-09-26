// lib/memoryCapture.js
// Captura automática (barata, sem LLM e sem falar no chat) do que o bot vê e
// vive, para a memória tipada: onde morreu e por quê, minérios valiosos à
// vista, a cama onde dormiu e os baús/mesas/fornalhas que usou.

const { visto } = require('../core/Memory')

const ORES = new Set([
  'diamond_ore', 'deepslate_diamond_ore',
  'emerald_ore', 'deepslate_emerald_ore',
  'gold_ore', 'deepslate_gold_ore',
  'iron_ore', 'deepslate_iron_ore',
  'ancient_debris'
])
const ORE_SCAN_MS = 10000     // varre os arredores a cada 10s
const ORE_RANGE = 16
const ORE_NEAR = 8            // minério a menos disso de um já anotado não vira fato novo
const ORE_PER_SCAN = 3        // no máximo 3 fatos novos por varredura
const ORE_TTL_MS = 7 * 24 * 3600 * 1000
const DEATH_TTL_MS = 3 * 24 * 3600 * 1000
const ATTACKER_WINDOW_MS = 10000

// Bloco usado -> nome do lugar anotado.
const STATIONS = {
  chest: 'baú',
  trapped_chest: 'baú',
  barrel: 'barril',
  crafting_table: 'mesa',
  furnace: 'fornalha',
  blast_furnace: 'alto-forno',
  smoker: 'defumador'
}

const floorPos = (p) => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) })
const fmt = (p) => `${p.x},${p.y},${p.z}`

function dimensionOf(bot) {
  const value = bot.game?.dimension
  if (value == null) return null
  return typeof value === 'string' ? value : value?.name ?? String(value)
}

// Nome do agressor legível ("creeper", "Zombie" -> "zombie", jogador pelo nick).
function attackerName(entity) {
  if (!entity) return null
  return String(entity.username || entity.name || entity.displayName || '').toLowerCase() || null
}

function attachMemoryCapture(bot, memory, { log = () => {}, now = () => Date.now(), scanMs = ORE_SCAN_MS, rememberWaypoint = () => {} } = {}) {
  let lastAttacker = null
  let lastDeath = null
  const timers = []
  const listeners = []
  let restoreActivateBlock = null
  const listen = (event, handler) => {
    bot.on(event, handler)
    listeners.push([event, handler])
  }
  const lastWaypointAt = new Map()
  const lastWaypointPos = new Map()
  const WAYPOINT_COOLDOWN_MS = 10 * 60 * 1000

  function captureWaypoint(name, position, context) {
    const key = `auto-${name}`
    const pos = floorPos(position)
    const stamp = fmt(pos)
    if (lastWaypointPos.get(key) === stamp) return false
    if (now() - (lastWaypointAt.get(key) || 0) < WAYPOINT_COOLDOWN_MS) return false
    lastWaypointAt.set(key, now())
    lastWaypointPos.set(key, stamp)
    rememberWaypoint(key, pos, dimensionOf(bot), context, visto())
    return true
  }

  const safe = (label, fn) => (...args) => {
    try {
      fn(...args)
    } catch (err) {
      log(`[memória] ${label}: ${err.message}`)
    }
  }

  // ---------- morte ----------
  listen('entityHurt', safe('dano', (entity, source) => {
    if (entity !== bot.entity) return
    const name = attackerName(source)
    if (name) lastAttacker = { name, at: now() }
  }))

  listen('death', safe('morte', () => {
    if (!bot.entity?.position) return
    const pos = floorPos(bot.entity.position)
    const cause = lastAttacker && now() - lastAttacker.at <= ATTACKER_WINDOW_MS ? lastAttacker.name : null
    const item = memory.registrarFato(
      `morri em ${fmt(pos)}${cause ? ` por ${cause}` : ''}`,
      { assunto: 'morte', posicao: pos, ttlMs: DEATH_TTL_MS },
      visto()
    )
    lastDeath = { item, at: now(), cause }
    lastAttacker = null
    log(`[memória] ${item.descricao}`)
  }))

  // Mensagem de morte do servidor ("eduardo_bot was blown up by Creeper") completa a causa.
  listen('messagestr', safe('mensagem', (message) => {
    if (!lastDeath || lastDeath.cause || now() - lastDeath.at > 5000) return
    const text = String(message || '')
    if (!text.startsWith(`${bot.username} `)) return
    const match = text.match(/\bby ([\w ]+?)(?: using .*)?$/i)
    if (!match) return
    const cause = match[1].trim().toLowerCase()
    lastDeath.cause = cause
    lastDeath.item.descricao = `${lastDeath.item.descricao} por ${cause}`
    memory.saveSoon()
  }))

  // ---------- minérios ----------
  function scanOres() {
    if (!bot.entity?.position || !bot.registry || typeof bot.findBlocks !== 'function') return 0
    const ids = [...ORES].map((name) => bot.registry.blocksByName[name]?.id).filter((id) => id != null)
    if (!ids.length) return 0
    const known = memory.listar('fato').filter((f) => f.assunto?.startsWith('minerio:') && f.posicao)
    let added = 0
    for (const p of bot.findBlocks({ matching: ids, maxDistance: ORE_RANGE, count: 32 })) {
      if (added >= ORE_PER_SCAN) break
      const name = bot.blockAt(p)?.name
      if (!ORES.has(name)) continue
      const pos = floorPos(p)
      const assunto = `minerio:${name}`
      const near = known.some((f) => f.assunto === assunto &&
        Math.abs(f.posicao.x - pos.x) <= ORE_NEAR && Math.abs(f.posicao.y - pos.y) <= ORE_NEAR &&
        Math.abs(f.posicao.z - pos.z) <= ORE_NEAR)
      if (near) continue
      const item = memory.registrarFato(`vi ${name} em ${fmt(pos)}`, { assunto, posicao: pos, ttlMs: ORE_TTL_MS }, visto())
      known.push(item)
      added++
    }
    if (added) log(`[memória] ${added} minério(s) valioso(s) anotado(s)`)
    return added
  }

  // Minério que sumiu (minerado por alguém): esquece o fato.
  listen('blockUpdate', safe('bloco', (oldBlock, newBlock) => {
    if (!oldBlock || !ORES.has(oldBlock.name) || ORES.has(newBlock?.name)) return
    memory.removerFatosPerto(`minerio:${oldBlock.name}`, floorPos(oldBlock.position), 0)
  }))

  if (scanMs > 0) {
    const t = setInterval(safe('varredura', scanOres), scanMs)
    t.unref?.()
    timers.push(t)
  }

  // ---------- cama ----------
  bot.on('sleep', safe('cama', () => {
    if (!bot.entity?.position || typeof bot.findBlock !== 'function') return
    const bed = bot.findBlock({ matching: (b) => b?.name?.endsWith('_bed'), maxDistance: 3 })
    const pos = bed?.position || bot.entity.position
    captureWaypoint('cama', pos, 'cama utilizada')
  }))

  // ---------- baús, mesas e fornalhas usados ----------
  // Todo abrir de container/mesa passa por bot.activateBlock (mineflayer).
  if (typeof bot.activateBlock === 'function' && !bot.activateBlock.__memoria) {
    const original = bot.activateBlock
    const wrapped = function (block, ...rest) {
      safe('estação', () => {
        const nome = STATIONS[block?.name]
        if (!nome || !block.position) return
        captureWaypoint(`estacao-${nome}`, block.position, `${nome} utilizado`)
      })()
      return original.call(this, block, ...rest)
    }
    wrapped.__memoria = true
    bot.activateBlock = wrapped
    restoreActivateBlock = () => {
      if (bot.activateBlock === wrapped) bot.activateBlock = original
    }
  }

  return {
    scanOres,
    stop: () => {
      timers.forEach(clearInterval)
      for (const [event, handler] of listeners) bot.removeListener(event, handler)
      restoreActivateBlock?.()
    }
  }
}

module.exports = { attachMemoryCapture, ORES, STATIONS }
