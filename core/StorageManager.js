const { goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')

const CONTAINER_NAMES = ['chest', 'trapped_chest', 'barrel']
const MAX_EXTRAS = 16
const NEAR_PRIMARY = 8

const keyOf = (p) => `${p.x},${p.y},${p.z}`
const floorPoint = (p) => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) })

function aggregateItems(items) {
  const counts = {}
  for (const item of items || []) {
    if (!item?.name) continue
    counts[item.name] = (counts[item.name] || 0) + (item.count || 0)
  }
  return counts
}

function isEquipment(name) {
  return /_(pickaxe|axe|shovel|hoe|sword|helmet|chestplate|leggings|boots)$/.test(name) ||
    ['shield', 'bow', 'crossbow', 'elytra', 'shears', 'flint_and_steel'].includes(name)
}

// Snapshot barato e somente leitura: capturado ANTES de pedir windowOpen e
// novamente após falha. Sem retry automático: um open tardio não deve causar
// duas janelas/duas operações de estoque concorrentes.
function containerInteractionSnapshot(bot, block) {
  const p = bot?.entity?.position
  const target = block?.position
  const point = (v) => v ? { x: v.x, y: v.y, z: v.z } : null
  const snapshot = {
    block: block?.name || null,
    target: point(target),
    botPosition: point(p),
    dimension: bot?.game?.dimension || null,
    currentWindow: Boolean(bot?.currentWindow),
    sneaking: null,
    eyeDistance: null,
    reachDistance: null,
    visible: null,
    above: null,
    neighbors: {}
  }
  if (!p || !target) return snapshot
  try {
    if (typeof bot.getControlState === 'function') snapshot.sneaking = Boolean(bot.getControlState('sneak'))
  } catch { /* só diagnóstico */ }
  const eye = new Vec3(p.x, p.y + (snapshot.sneaking ? 1.27 : 1.62), p.z)
  const tx = Number(target.x), ty = Number(target.y), tz = Number(target.z)
  if ([tx, ty, tz].every(Number.isFinite)) {
    snapshot.eyeDistance = Number(eye.distanceTo(new Vec3(tx + 0.5, ty + 0.5, tz + 0.5)).toFixed(3))
    const axisGap = (v, min) => Math.max(min - v, 0, v - (min + 1))
    snapshot.reachDistance = Number(Math.hypot(axisGap(eye.x, tx), axisGap(eye.y, ty), axisGap(eye.z, tz)).toFixed(3))
    if (typeof bot.blockAt === 'function') {
      const sample = (dx, dy, dz) => {
        try {
          const b = bot.blockAt(new Vec3(tx + dx, ty + dy, tz + dz))
          return b ? { name: b.name || null, boundingBox: b.boundingBox || null } : null
        } catch { return null }
      }
      snapshot.above = sample(0, 1, 0)
      snapshot.neighbors = {
        north: sample(0, 0, -1), south: sample(0, 0, 1),
        west: sample(-1, 0, 0), east: sample(1, 0, 0)
      }
    }
  }
  try {
    if (typeof bot.canSeeBlock === 'function') snapshot.visible = Boolean(bot.canSeeBlock(block))
  } catch { /* só diagnóstico */ }
  return snapshot
}

class StorageManager {
  constructor() {
    this.position = null
    this._lock = Promise.resolve()
    this._botQueues = new WeakMap()
    this._snapshot = {}
    this.lastUpdatedAt = 0
    this._ensurePromise = null
    this.recoverContainer = null
    this.onPositionChanged = null
    // Baús extras ao lado do central: quando o último enche, `expandContainer(bot, anchor)` coloca outro.
    this.extras = []
    this._snapshots = new Map()
    this.expandContainer = null
    this._expandPromise = null
    // Bots fazendo um baú novo: o "guardar carga" no fim da coleta de madeira deles não pode
    // esperar pelo próprio baú (travava) nem guardar a madeira que vai virar o baú.
    this._expanding = new WeakSet()
  }

  // Central primeiro, depois os extras na ordem em que foram criados.
  positions() {
    return this.position ? [{ ...this.position }, ...this.extras.map((p) => ({ ...p }))] : []
  }

  // Para os laços: sem posição salva, um único "baú padrão" (withContainer decide o erro).
  targets() {
    const list = this.positions()
    return list.length ? list : [null]
  }

  getExtras() {
    return this.extras.map((p) => ({ ...p }))
  }

  setExtras(list) {
    this.extras = []
    for (const p of Array.isArray(list) ? list : []) this.addExtra(p)
  }

  addExtra(position) {
    if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) return false
    const point = floorPoint(position)
    if (this.positions().some((p) => keyOf(p) === keyOf(point))) return false
    if (this.extras.length >= MAX_EXTRAS) return false
    this.extras.push(point)
    return true
  }

  configured() {
    return Boolean(this.position)
  }

  setPosition(position) {
    if (!position) {
      this.position = null
      this.extras = []
      this._snapshots = new Map()
      this._snapshot = {}
      this.lastUpdatedAt = 0
      return null
    }
    const next = floorPoint(position)
    // Estoque redefinido em outro lugar: os extras do antigo não valem mais.
    const old = this.position
    if (old && Math.hypot(old.x - next.x, old.y - next.y, old.z - next.z) > NEAR_PRIMARY) this.extras = []
    this.extras = this.extras.filter((p) => keyOf(p) !== keyOf(next))
    this.position = next
    this._snapshots = new Map()
    this._snapshot = {}
    this.lastUpdatedAt = 0
    return { ...this.position }
  }

  // `at` = qual baú foi lido (padrão: o central). O resumo soma todos os baús.
  updateSnapshot(items, at = null) {
    const where = at || this.position
    this._snapshots.set(where ? keyOf(where) : 'central', aggregateItems(items))
    const total = {}
    for (const counts of this._snapshots.values()) {
      for (const [name, count] of Object.entries(counts)) total[name] = (total[name] || 0) + count
    }
    this._snapshot = total
    this.lastUpdatedAt = Date.now()
    return this.cachedSummary()
  }

  // Pelo último resumo: este baú tem o item? (desconhecido conta como talvez)
  mayHave(at, names) {
    if (!at) return true
    const counts = this._snapshots.get(keyOf(at))
    if (!counts) return true
    return [].concat(names).some((name) => (counts[name] || 0) > 0)
  }

  cachedSummary() {
    return { ...this._snapshot }
  }

  snapshotAgeMs() {
    return this.lastUpdatedAt ? Date.now() - this.lastUpdatedAt : Infinity
  }

  snapshotFresh(maxAgeMs = 30000) {
    return this.snapshotAgeMs() <= maxAgeMs
  }

  getPosition() {
    return this.position ? { ...this.position } : null
  }

  findNearby(bot, maxDistance = 8) {
    const ids = CONTAINER_NAMES
      .map((name) => bot.registry?.blocksByName?.[name]?.id)
      .filter(Number.isInteger)
    if (!ids.length) return null
    return bot.findBlock({ matching: ids, maxDistance })
  }

  configureNearest(bot, maxDistance = 8) {
    const block = this.findNearby(bot, maxDistance)
    if (!block) throw new Error(`nenhum baú/barrel encontrado em ${maxDistance} blocos`)
    this.setPosition(block.position)
    return block
  }

  async ensureConfigured(bot, createContainer) {
    if (this.configured()) return this.getPosition()
    if (this._ensurePromise) return this._ensurePromise
    this._ensurePromise = (async () => {
      if (this.configured()) return this.getPosition()
      const nearby = this.findNearby(bot, 8)
      if (nearby) return this.setPosition(nearby.position)
      if (typeof createContainer !== 'function') throw new Error('não há baú próximo e não foi fornecido criador de baú')
      const position = await createContainer()
      if (!position) throw new Error('não foi possível criar um baú para o estoque')
      return this.setPosition(position)
    })()
    try {
      return await this._ensurePromise
    } finally {
      this._ensurePromise = null
    }
  }

  block(bot, at = this.position) {
    if (!at) throw new Error('estoque central ainda não foi definido')
    const block = bot.blockAt(new Vec3(at.x, at.y, at.z))
    if (!block || !CONTAINER_NAMES.includes(block.name)) {
      throw new Error('o container configurado para o estoque não está disponível')
    }
    return block
  }

  async resolveContainer(bot, at = this.position) {
    const primary = !this.position || keyOf(at) === keyOf(this.position)
    try { return this.block(bot, at) } catch (originalError) {
      if (!primary) throw originalError
      const saved = this.getPosition()
      const from = bot.entity?.position
      if (!saved || !from || from.distanceTo(new Vec3(saved.x, saved.y, saved.z)) > 6) throw originalError
      // Null is an unloaded chunk, not proof that somebody removed the chest.
      const observed = bot.blockAt(new Vec3(saved.x, saved.y, saved.z))
      if (!observed) throw originalError
      const replacement = this.findNearby(bot, 6) || (this.recoverContainer ? await this.recoverContainer(bot, saved) : null)
      if (!replacement || !CONTAINER_NAMES.includes(replacement.name) || !replacement.position) throw originalError
      if (from.distanceTo(replacement.position) > 6) throw originalError
      this.setPosition(replacement.position)
      this.onPositionChanged?.(this.getPosition())
      console.log(`[estoque] container recuperado em ${replacement.position.x},${replacement.position.y},${replacement.position.z}`)
      return replacement
    }
  }

  async goNear(bot, position, timeoutMs = null) {
    if (!bot.pathfinder) throw new Error('pathfinder indisponível')
    // Longe da base, 15 s não bastam: ~700 ms por bloco, como nas viagens dos workers.
    if (timeoutMs == null) {
      const from = bot.entity?.position
      const distance = from ? Math.hypot(from.x - position.x, from.y - position.y, from.z - position.z) : 0
      // Com 5 workers e caminhos longos, 700 ms/bloco não bastava: o
      // minerador voltava do subsolo com pedra e era interrompido no meio.
      timeoutMs = Math.min(360000, Math.max(30000, Math.round(distance * 1500)))
    }
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        bot.pathfinder.setGoal(null)
        reject(new Error('demorei demais para chegar ao estoque'))
      }, timeoutMs)
    })
    // Worker que cavou um poço/fechou-se no subsolo não consegue voltar com
    // canDig=false. Só neste trajeto até o baú permitimos cavar; os blocos
    // protegidos (cercas/curral) continuam na lista de evitar.
    const movements = bot.pathfinder.movements
    const previousCanDig = movements ? movements.canDig : undefined
    if (movements) movements.canDig = true
    try {
      await Promise.race([
        bot.pathfinder.goto(new goals.GoalNear(position.x, position.y, position.z, 2)),
        timeout
      ])
    } finally {
      clearTimeout(timer)
      if (movements && previousCanDig !== undefined) movements.canDig = previousCanDig
    }
  }

  // Baú extra que sumiu do mundo sai da lista; o central continua lançando o erro.
  async eachContainer(bot, at, fn) {
    if (!at || !this.position || keyOf(at) === keyOf(this.position)) return this.withContainer(bot, fn, { at })
    try {
      return await this.withContainer(bot, fn, { at })
    } catch (err) {
      if (/não está disponível/.test(err?.message || '')) {
        this.extras = this.extras.filter((p) => keyOf(p) !== keyOf(at))
        this._snapshots.delete(keyOf(at))
        this.onPositionChanged?.(this.getPosition())
      }
      console.log(`[estoque] baú extra ${keyOf(at)}: ${err?.message || err}`)
      return undefined
    }
  }

  async withContainer(bot, fn, { at = null } = {}) {
    // Um bot faz uma operação de baú por vez: duas ao mesmo tempo trocariam o
    // objetivo do pathfinder uma da outra ("The goal was changed...").
    const previousOwn = this._botQueues.get(bot) || Promise.resolve()
    let releaseOwn
    const own = new Promise((resolve) => { releaseOwn = resolve })
    this._botQueues.set(bot, own)
    await previousOwn

    try {
      // Anda até o baú antes de entrar na fila: a trava só cobre abrir e mexer
      // nos itens, para um bot longe não segurar os outros enquanto caminha.
      // Vai pela posição salva: longe da base o chunk do baú ainda não está
      // carregado e this.block() falharia antes de o bot sair do lugar.
      if (!this.position) throw new Error('estoque central ainda não foi definido')
      const target = at ? floorPoint(at) : this.position
      await this.goNear(bot, target)

      const previous = this._lock
      let release
      this._lock = new Promise((resolve) => { release = resolve })
      await previous

      let container
      try {
        const block = await this.resolveContainer(bot, target)
        const beforeOpen = containerInteractionSnapshot(bot, block)
        try {
          container = await bot.openContainer(block)
        } catch (error) {
          // A mensagem original (inclusive windowOpen timeout) continua sendo
          // propagada: os dados extras permitem separar alcance, obstrução,
          // sneak e janela já aberta sem atribuir causa não comprovada.
          const diagnostic = {
            worker: bot.username || null,
            error: error?.message || String(error),
            before: beforeOpen,
            after: containerInteractionSnapshot(bot, block)
          }
          if (error && typeof error === 'object') error.storageDiagnostics = diagnostic
          console.warn(`[estoque] container_open_failed ${JSON.stringify(diagnostic)}`)
          throw error
        }
        return await fn(container)
      } finally {
        try { container?.close() } catch {}
        release()
      }
    } finally {
      releaseOwn()
      if (this._botQueues.get(bot) === own) this._botQueues.delete(bot)
    }
  }


  async summary(bot) {
    let total = {}
    for (const at of this.targets()) {
      total = (await this.eachContainer(bot, at, async (container) => this.updateSnapshot(container.containerItems(), at))) || total
    }
    return total
  }

  async count(bot, itemName) {
    const counts = await this.summary(bot)
    return counts[itemName] || 0
  }

  async withdraw(bot, itemName, count = 1) {
    let remaining = Math.max(1, Number(count) || 1)
    let got = 0
    for (const at of this.targets()) {
      if (remaining <= 0) break
      if (!this.mayHave(at, itemName)) continue
      const amount = (await this.eachContainer(bot, at, async (container) => {
        const available = container.containerItems()
          .filter((item) => item.name === itemName)
          .reduce((sum, item) => sum + item.count, 0)
        const take = Math.min(remaining, available)
        if (take > 0) {
          const sample = container.containerItems().find((item) => item.name === itemName)
          await container.withdraw(sample.type, null, take)
        }
        this.updateSnapshot(container.containerItems(), at)
        return take
      })) || 0
      got += amount
      remaining -= amount
    }
    return got
  }

  async withdrawFirst(bot, names, count = 1) {
    const wanted = Math.max(1, Number(count) || 1)
    for (const at of this.targets()) {
      if (!this.mayHave(at, names)) continue
      const taken = await this.eachContainer(bot, at, async (container) => {
        const items = container.containerItems()
        for (const name of names) {
          const available = items.filter((item) => item.name === name)
            .reduce((sum, item) => sum + item.count, 0)
          if (available < wanted) continue
          const sample = items.find((item) => item.name === name)
          await container.withdraw(sample.type, null, wanted)
          this.updateSnapshot(container.containerItems(), at)
          return { name, count: wanted }
        }
        this.updateSnapshot(items, at)
        return null
      })
      if (taken) return taken
    }
    return null
  }

  async deposit(bot, itemName, count = null) {
    const available = bot.inventory.items().filter((item) => item.name === itemName)
      .reduce((sum, item) => sum + item.count, 0)
    const amount = Math.min(count == null ? available : Math.max(0, Number(count) || 0), available)
    if (amount <= 0) return 0
    const deposited = await this.depositPlan(bot, new Map([[itemName, amount]]))
    return deposited[itemName] || 0
  }

  // Deposita quantidades específicas (ex.: só ferro) sem esvaziar a mochila.
  async depositMany(bot, counts) {
    if (!this.configured()) return {}
    const wanted = new Map()
    for (const [name, count] of Object.entries(counts || {})) {
      const amount = Math.max(0, Number(count) || 0)
      if (amount > 0) wanted.set(name, amount)
    }
    if (!wanted.size) return {}
    return this.depositPlan(bot, wanted)
  }

  // Põe `wanted` (nome -> quantidade) nos baús em ordem; quando todos enchem,
  // pede um baú novo ao lado do último e continua nele.
  async depositPlan(bot, wanted) {
    const deposited = {}
    if (this._expanding.has(bot)) return deposited
    const left = () => [...wanted.values()].reduce((sum, n) => sum + n, 0)
    const held = (name) => bot.inventory.items().filter((i) => i.name === name).reduce((sum, i) => sum + i.count, 0)
    const fill = (at) => this.eachContainer(bot, at, async (container) => {
      for (const item of bot.inventory.items()) {
        const limit = wanted.get(item.name)
        if (!limit) continue
        const amount = Math.min(item.count, limit)
        const before = held(item.name)
        let moved = amount
        try {
          await container.deposit(item.type, null, amount)
        } catch {
          // Baú cheio para este item: o que coube fica, o resto vai ao próximo baú.
          moved = Math.max(0, Math.min(limit, before - held(item.name)))
        }
        if (moved) {
          deposited[item.name] = (deposited[item.name] || 0) + moved
          wanted.set(item.name, limit - moved)
        }
      }
      this.updateSnapshot(container.containerItems(), at)
    })

    for (const at of this.targets()) {
      if (left() <= 0) break
      await fill(at)
    }
    if (left() > 0 && typeof this.expandContainer === 'function') {
      const added = await this.expand(bot).catch((err) => {
        console.log(`[estoque] baús cheios e não consegui criar outro: ${err.message}`)
        return null
      })
      if (added) await fill(added)
    }
    if (left() > 0) console.log(`[estoque] ${bot.username || 'bot'} ficou com ${left()} item(ns) na mochila: baús cheios`)
    return deposited
  }

  // Um baú novo por vez: quem chega junto espera e usa o mesmo.
  async expand(bot) {
    if (this._expandPromise) return this._expandPromise
    const anchor = this.positions().at(-1)
    if (!anchor) return null
    this._expandPromise = (async () => {
      this._expanding.add(bot)
      let block
      try {
        block = await this.expandContainer(bot, anchor)
      } finally {
        this._expanding.delete(bot)
      }
      if (!block?.position || !CONTAINER_NAMES.includes(block.name)) throw new Error('baú novo não confirmado')
      const at = floorPoint(block.position)
      this.addExtra(at)
      this.onPositionChanged?.(this.getPosition())
      console.log(`[estoque] baú cheio; ${bot.username || 'bot'} colocou outro em ${at.x},${at.y},${at.z}`)
      return at
    })()
    try {
      return await this._expandPromise
    } finally {
      this._expandPromise = null
    }
  }

  reserveFor(bot, item) {
    if (isEquipment(item.name)) return item.count
    if (bot.registry?.foodsByName?.[item.name]) return Math.min(item.count, 8)
    return 0
  }

  async depositCargo(bot) {
    if (!this.configured() || this._expanding.has(bot)) return {}
    let foodBudget = 8
    const wanted = new Map()
    for (const item of bot.inventory.items()) {
      let keep = this.reserveFor(bot, item)
      if (!isEquipment(item.name) && bot.registry?.foodsByName?.[item.name]) {
        keep = Math.min(item.count, foodBudget)
        foodBudget -= keep
      }
      const amount = Math.max(0, item.count - keep)
      if (amount) wanted.set(item.name, (wanted.get(item.name) || 0) + amount)
    }
    if (!wanted.size) {
      // Nada a guardar: só atualiza o resumo do central, como antes.
      await this.withContainer(bot, async (container) => { this.updateSnapshot(container.containerItems()) })
      return {}
    }
    return this.depositPlan(bot, wanted)
  }

  async withdrawBestTool(bot, kind) {
    const suffix = String(kind || '').replace(/^_/, '')
    const order = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden']
      .map((tier) => `${tier}_${suffix}`)
    return this.withdrawFirst(bot, order, 1)
  }

  buildingMaterialNames() {
    return [
      'cobblestone', 'stone', 'deepslate', 'cobbled_deepslate',
      'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
      'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
      'bamboo_planks', 'dirt'
    ]
  }

  async withdrawBuildingMaterial(bot, count = 23) {
    const wanted = Math.max(1, Number(count) || 1)
    const names = this.buildingMaterialNames()
    const withdrawn = {}
    let remaining = wanted
    for (const at of this.targets()) {
      if (remaining <= 0) break
      if (!this.mayHave(at, names)) continue
      await this.eachContainer(bot, at, async (container) => {
        for (const name of names) {
          if (remaining <= 0) break
          const items = container.containerItems()
          const available = items
            .filter((item) => item.name === name)
            .reduce((sum, item) => sum + item.count, 0)
          if (available <= 0) continue
          const amount = Math.min(remaining, available)
          const sample = items.find((item) => item.name === name)
          await container.withdraw(sample.type, null, amount)
          withdrawn[name] = (withdrawn[name] || 0) + amount
          remaining -= amount
        }
        this.updateSnapshot(container.containerItems(), at)
      })
    }
    return {
      requested: wanted,
      withdrawn: wanted - remaining,
      complete: remaining === 0,
      items: withdrawn
    }
  }
}

module.exports = { StorageManager, CONTAINER_NAMES, aggregateItems, isEquipment, containerInteractionSnapshot }
