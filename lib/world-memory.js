// lib/world-memory.js
// Memória espacial persistente do mundo: CONHECIMENTO, nunca executor.
//
// Regra de ouro: tudo aqui é hipótese útil. Antes de agir o chamador chega perto,
// percebe o mundo real e só então confirma (confirm) ou invalida (invalidate).
// Esta camada não conhece mineflayer, não anda, não minera e não decide safety.
//
// Registros:
//   places    — landmarks de bloco exato (crafting_table, mine_entry...) e regiões por chunk
//               (wood, stone, iron, coal..., hazards lava/water/route_failed).
//   explored  — cobertura por chunk (visitedAt, visitas).
// Toda chave inclui a dimensão. base/storage NÃO são duplicados: vêm dos providers
// existentes (WaypointManager / StorageManager) e aqui só ficam as confirmações.
//
// Persistência: JSON atômico (tmp+rename), debounced, só em eventos significativos;
// arquivo ausente/corrompido/de versão futura nunca derruba o runtime.

const fs = require('fs')
const path = require('path')

const VERSION = 1
const STATUS = Object.freeze({ CONFIRMED: 'CONFIRMED', STALE: 'STALE', INVALIDATED: 'INVALIDATED' })
const BLOCK_KINDS = new Set(['crafting_table', 'mine_entry', 'furnace'])
const HAZARD_KINDS = new Set(['lava', 'water', 'drop', 'route_failed'])
const HOUR = 3600 * 1000

const DEFAULTS = {
  ttlMs: { crafting_table: 6 * HOUR, furnace: 6 * HOUR, mine_entry: 12 * HOUR, resource: 2 * HOUR, hazard: 24 * HOUR },
  exploredRecentMs: 30 * 60 * 1000,
  tombstoneMs: 7 * 24 * HOUR,
  maxPlaces: 512,
  maxExplored: 4096,
  persistDebounceMs: 2000
}

function normalizeDimension(value) {
  if (value == null) return 'overworld'
  const raw = typeof value === 'string' ? value : (value.name || String(value))
  return raw.replace(/^minecraft:/, '') || 'overworld'
}

const chunkOf = (n) => Math.floor(n / 16)
const num = (v) => (Number.isFinite(Number(v)) ? Math.floor(Number(v)) : null)
const dist = (a, b) => Math.hypot(a.x - b.x, (a.y ?? 0) === (b.y ?? 0) ? 0 : ((a.y ?? 0) - (b.y ?? 0)) * 0.5, a.z - b.z)
const scopeOf = (kind) => (BLOCK_KINDS.has(kind) ? 'block' : 'chunk')

function placeKey(dim, kind, x, z, y) {
  return scopeOf(kind) === 'block'
    ? `${dim}|${kind}|${x},${y},${z}`
    : `${dim}|${kind}|${chunkOf(x)},${chunkOf(z)}`
}

class WorldMemory {
  constructor({ file = null, now = Date.now, logger = null, options = {}, providers = {} } = {}) {
    this.file = file ? path.resolve(file) : null
    this.now = now
    this.logger = logger
    this.opts = { ...DEFAULTS, ...options, ttlMs: { ...DEFAULTS.ttlMs, ...(options.ttlMs || {}) } }
    this.providers = providers // { base: () => ({x,y,z,dimension}), storage: () => ({x,y,z}) }
    this.places = new Map()
    this.explored = new Map()
    this.landmarkConfirmations = {} // base/storage: só carimbos; posição vem dos providers
    this.metrics = { created: 0, confirmed: 0, invalidated: 0, queries: 0, verified: 0, usefulQueries: 0, staleQueries: 0, exploredChunks: 0, exploreChoices: 0, exploreRepeats: 0 }
    this.session = { exploreDestinations: [], created: 0, confirmed: 0, invalidated: 0 }
    this.readOnly = false
    this.loadStatus = 'none'
    this.extra = {}
    this._dirty = false
    this._timer = null
    this._write = Promise.resolve()
    this._seq = 0
    this._newSinceLog = 0
  }

  log(msg) { this.logger?.log?.(`[world-memory] ${msg}`) }

  // ---------- persistência ----------
  load() {
    if (!this.file) return this
    let raw
    try { raw = fs.readFileSync(this.file, 'utf8') } catch (err) {
      this.loadStatus = err.code === 'ENOENT' ? 'missing' : `unreadable:${err.code}`
      return this
    }
    let data
    try { data = JSON.parse(raw) } catch {
      // Conteúdo parcial/corrompido: preserva a evidência e começa vazio.
      try { fs.renameSync(this.file, `${this.file}.corrupt-${this.now()}`) } catch { /* melhor esforço */ }
      this.loadStatus = 'corrupt'
      this.log('arquivo corrompido preservado; memória vazia')
      return this
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { this.loadStatus = 'corrupt'; return this }
    if (Number.isInteger(data.version) && data.version > VERSION) {
      // Versão futura: usa vazio em memória, nunca sobrescreve o arquivo.
      this.readOnly = true
      this.loadStatus = 'future-version'
      this.log(`versão ${data.version} > ${VERSION}: somente leitura, arquivo preservado`)
      return this
    }
    let dropped = 0
    for (const raw of Array.isArray(data.places) ? data.places : []) {
      const p = this._sanitizePlace(raw)
      if (p) this.places.set(p.key, p); else dropped++
    }
    for (const row of Array.isArray(data.explored) ? data.explored : []) {
      if (!Array.isArray(row) || typeof row[0] !== 'string' || !Number.isFinite(row[1])) { dropped++; continue }
      this.explored.set(row[0], { t: row[1], n: Math.max(1, row[2] | 0), f: Number.isFinite(row[3]) ? row[3] : row[1] })
    }
    if (data.metrics && typeof data.metrics === 'object') {
      for (const k of Object.keys(this.metrics)) if (Number.isFinite(data.metrics[k])) this.metrics[k] = data.metrics[k]
    }
    if (data.landmarks && typeof data.landmarks === 'object') this.landmarkConfirmations = { ...data.landmarks }
    this.extra = data.extra && typeof data.extra === 'object' ? data.extra : {}
    this.loadStatus = dropped ? `loaded-with-${dropped}-dropped` : 'loaded'
    return this
  }

  _sanitizePlace(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.kind !== 'string') return null
    const x = num(raw.x), y = num(raw.y), z = num(raw.z)
    if (x == null || y == null || z == null) return null
    const dim = normalizeDimension(raw.dim)
    const status = Object.values(STATUS).includes(raw.status) ? raw.status : STATUS.STALE
    const t = Number.isFinite(raw.lastSeenAt) ? raw.lastSeenAt : this.now()
    return {
      key: placeKey(dim, raw.kind, x, z, y), kind: raw.kind, dim, x, y, z, status,
      count: Math.max(1, num(raw.count) || 1),
      firstSeenAt: Number.isFinite(raw.firstSeenAt) ? raw.firstSeenAt : t,
      lastSeenAt: t,
      lastConfirmedAt: Number.isFinite(raw.lastConfirmedAt) ? raw.lastConfirmedAt : null,
      invalidatedAt: Number.isFinite(raw.invalidatedAt) ? raw.invalidatedAt : null,
      confirmations: Math.max(0, num(raw.confirmations) || 0),
      failures: Math.max(0, num(raw.failures) || 0),
      skipUntil: Number.isFinite(raw.skipUntil) ? raw.skipUntil : 0,
      by: typeof raw.by === 'string' ? raw.by : null
    }
  }

  _serialize() {
    const places = [...this.places.values()].map(({ key, suggested, ...p }) => p)
    return {
      version: VERSION,
      savedAt: new Date(this.now()).toISOString(),
      places,
      explored: [...this.explored.entries()].map(([k, v]) => [k, v.t, v.n, v.f]),
      landmarks: this.landmarkConfirmations,
      metrics: this.metrics,
      extra: this.extra
    }
  }

  _markDirty() {
    this._dirty = true
    if (!this.file || this.readOnly || this._timer) return
    this._timer = setTimeout(() => { this._timer = null; this.flush().catch((err) => this.log(`falha ao salvar: ${err.message}`)) }, this.opts.persistDebounceMs)
    this._timer.unref?.()
  }

  flush() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null }
    if (!this.file || this.readOnly || !this._dirty) return this._write
    this._dirty = false
    const body = JSON.stringify(this._serialize()) + '\n'
    const run = async () => {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp-${process.pid}-${++this._seq}`
      try {
        await fs.promises.writeFile(tmp, body, 'utf8')
        await fs.promises.rename(tmp, this.file)
      } finally { await fs.promises.rm(tmp, { force: true }) }
    }
    this._write = this._write.then(run, run)
    return this._write
  }

  flushSync() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null }
    if (!this.file || this.readOnly || !this._dirty) return
    this._dirty = false
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}-${++this._seq}`
    fs.writeFileSync(tmp, JSON.stringify(this._serialize()) + '\n')
    fs.renameSync(tmp, this.file)
  }

  // ---------- status / validade ----------
  ttlFor(kind) {
    if (this.opts.ttlMs[kind]) return this.opts.ttlMs[kind]
    return HAZARD_KINDS.has(kind) ? this.opts.ttlMs.hazard : this.opts.ttlMs.resource
  }

  effectiveStatus(place) {
    if (place.status === STATUS.INVALIDATED) return STATUS.INVALIDATED
    if (place.status === STATUS.STALE) return STATUS.STALE
    const ref = place.lastConfirmedAt ?? place.lastSeenAt
    return this.now() - ref > this.ttlFor(place.kind) ? STATUS.STALE : STATUS.CONFIRMED
  }

  // ---------- escrita de conhecimento ----------
  // discover: algo foi VISTO agora no mundo real (cria ou renova como CONFIRMED).
  discover(kind, dimension, pos, { count = 1, by = null } = {}) {
    const dim = normalizeDimension(dimension)
    const x = num(pos?.x), y = num(pos?.y), z = num(pos?.z)
    if (!kind || x == null || y == null || z == null) return null
    const key = placeKey(dim, kind, x, z, y)
    const t = this.now()
    let p = this.places.get(key)
    if (!p) {
      p = { key, kind, dim, x, y, z, status: STATUS.CONFIRMED, count: Math.max(1, count), firstSeenAt: t, lastSeenAt: t, lastConfirmedAt: t, invalidatedAt: null, confirmations: 1, failures: 0, skipUntil: 0, by }
      this.places.set(key, p)
      this.metrics.created++; this.session.created++
      this.log(`discover ${kind} ${dim} (${x},${y},${z})${count > 1 ? ` n=${count}` : ''}${by ? ` by=${by}` : ''}`)
      this._evict()
      this._markDirty()
      return p
    }
    const was = this.effectiveStatus(p)
    p.lastSeenAt = t; p.lastConfirmedAt = t; p.count = Math.max(1, count)
    if (scopeOf(kind) === 'chunk') { p.x = x; p.y = y; p.z = z } // âncora = amostra mais recente
    return this._confirmed(p, was, by)
  }

  confirm(key, { by = null } = {}) {
    const p = this.places.get(key)
    if (!p) return null
    const was = this.effectiveStatus(p)
    const t = this.now()
    p.lastSeenAt = t; p.lastConfirmedAt = t
    this.metrics.verified++ // conferência física bem-sucedida (mesmo que já estivesse CONFIRMED)
    return this._confirmed(p, was, by)
  }

  _confirmed(p, was, by) {
    p.status = STATUS.CONFIRMED; p.invalidatedAt = null; p.failures = 0; p.skipUntil = 0
    p.confirmations++
    if (by) p.by = by
    if (was !== STATUS.CONFIRMED) {
      this.metrics.confirmed++; this.session.confirmed++
      this.log(`confirm ${p.kind} ${p.dim} (${p.x},${p.y},${p.z}) was=${was}`)
      this._markDirty()
    }
    if (p.suggested) { p.suggested = false; this.metrics.usefulQueries++ }
    return p
  }

  invalidate(key, reason = '') {
    const p = this.places.get(key)
    if (!p || p.status === STATUS.INVALIDATED) return null
    p.status = STATUS.INVALIDATED; p.invalidatedAt = this.now()
    this.metrics.invalidated++; this.session.invalidated++
    if (p.suggested) { p.suggested = false; this.metrics.staleQueries++ }
    this.log(`invalidate ${p.kind} ${p.dim} (${p.x},${p.y},${p.z})${reason ? ` reason=${reason}` : ''}`)
    this._markDirty()
    return p
  }

  // Aproximação falhou sem evidência do mundo (rota/ameaça): não invalida, só adia a sugestão.
  noteApproachFailure(key) {
    const p = this.places.get(key)
    if (!p) return null
    p.failures++
    p.skipUntil = this.now() + Math.min(60, 5 * 2 ** (p.failures - 1)) * 60 * 1000
    if (p.suggested) p.suggested = false
    this._markDirty()
    return p
  }

  // Hazard: registro curto por chunk (lava/água/queda); route_failed acumula falhas por destino.
  markHazard(kind, dimension, pos, { by = null } = {}) {
    if (!HAZARD_KINDS.has(kind)) return null
    const prev = this.find(kind, dimension, pos)?.failures || 0 // discover() zera falhas ao confirmar
    const p = this.discover(kind, dimension, pos, { by })
    if (p && kind === 'route_failed') p.failures = prev + 1
    return p
  }

  find(kind, dimension, pos) {
    const dim = normalizeDimension(dimension)
    return this.places.get(placeKey(dim, kind, num(pos.x), num(pos.z), num(pos.y)))
  }

  // ---------- cobertura ----------
  visit(dimension, pos) {
    const dim = normalizeDimension(dimension)
    const x = num(pos?.x), z = num(pos?.z)
    if (x == null || z == null) return false
    const key = `${dim}|${chunkOf(x)},${chunkOf(z)}`
    const t = this.now()
    const e = this.explored.get(key)
    if (e) { e.t = t; e.n++; return false }
    this.explored.set(key, { t, n: 1, f: t })
    this.metrics.exploredChunks++
    this._newSinceLog++
    if (this.explored.size > this.opts.maxExplored) this._evictExplored()
    this._markDirty()
    return true
  }

  // Chunks novos desde o último log (agrega o log por varredura em vez de uma linha por chunk).
  takeNewChunks() { const n = this._newSinceLog; this._newSinceLog = 0; return n }

  exploredInfo(dimension, pos) {
    return this.explored.get(`${normalizeDimension(dimension)}|${chunkOf(num(pos.x))},${chunkOf(num(pos.z))}`) || null
  }

  exploredRecently(dimension, pos, withinMs = this.opts.exploredRecentMs) {
    const e = this.exploredInfo(dimension, pos)
    return Boolean(e && this.now() - e.t <= withinMs)
  }

  exploredCount(dimension) {
    const prefix = `${normalizeDimension(dimension)}|`
    let n = 0
    for (const k of this.explored.keys()) if (k.startsWith(prefix)) n++
    return n
  }

  // Escolhe, entre candidatos geométricos, o de melhor custo: perto, pouco visitado, sem hazard.
  // Devolve null com memória vazia (o chamador mantém o padrão clássico).
  chooseExploreTarget(dimension, candidates, from) {
    const dim = normalizeDimension(dimension)
    if (!candidates.length || this.exploredCount(dim) === 0) return null
    let best = null
    for (const c of candidates) {
      const e = this.exploredInfo(dim, c)
      let cost = Math.hypot(c.x - from.x, c.z - from.z) / 16
      if (e) cost += (this.now() - e.t <= this.opts.exploredRecentMs ? 100 : 20) + 5 * Math.min(e.n, 10)
      for (const kind of HAZARD_KINDS) {
        const h = this.places.get(placeKey(dim, kind, c.x, c.z, 0))
        if (!h || h.status === STATUS.INVALIDATED || this.effectiveStatus(h) === STATUS.STALE) continue
        cost += kind === 'lava' ? 50 : kind === 'route_failed' ? Math.min(100, 30 * (h.failures || 1)) : 10
      }
      if (!best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) < 1e-9 && (c.order ?? 0) < (best.candidate.order ?? 0))) best = { candidate: c, cost }
    }
    return best
  }

  // Métrica comparável com/sem memória: toda escolha de destino de exploração é registrada.
  recordExploreDestination(dimension, pos, { guided = false } = {}) {
    const repeat = this.exploredRecently(dimension, pos)
    this.metrics.exploreChoices++
    if (repeat) this.metrics.exploreRepeats++
    this.session.exploreDestinations.push({ cx: chunkOf(pos.x), cz: chunkOf(pos.z), repeat, guided })
    if (this.session.exploreDestinations.length > 200) this.session.exploreDestinations.shift()
    return repeat
  }

  // ---------- consulta ----------
  // Hipóteses ordenadas (CONFIRMED antes de STALE, depois distância). Nunca INVALIDATED nem em cooldown.
  suggest(kind, dimension, from, { maxDistance = 160, limit = 3, exclude = null } = {}) {
    const dim = normalizeDimension(dimension)
    this.metrics.queries++
    const t = this.now()
    const out = []
    for (const p of this.places.values()) {
      if (p.kind !== kind || p.dim !== dim || p.status === STATUS.INVALIDATED || p.skipUntil > t) continue
      if (exclude && exclude.has(p.key)) continue
      const d = dist(p, from)
      if (d > maxDistance) continue
      out.push({ place: p, distance: d, status: this.effectiveStatus(p) })
    }
    out.sort((a, b) => (a.status === b.status ? a.distance - b.distance : a.status === STATUS.CONFIRMED ? -1 : 1))
    const picked = out.slice(0, limit)
    for (const s of picked) s.place.suggested = true
    if (picked.length) this.log(`suggest ${kind} ${dim} -> (${picked[0].place.x},${picked[0].place.y},${picked[0].place.z}) ${picked[0].status} d=${Math.round(picked[0].distance)}`)
    return picked
  }

  // Ponto conhecido com mesa + madeira + pedra por perto (hipótese de staging; não autoriza ação).
  suggestPreparationSite(dimension, from, { radius = 12, maxDistance = 160 } = {}) {
    const dim = normalizeDimension(dimension)
    const t = this.now()
    const near = (kind, table) => [...this.places.values()].filter((p) =>
      p.kind === kind && p.dim === dim && p.status !== STATUS.INVALIDATED && dist(p, table) <= radius)
      .sort((a, b) => dist(a, table) - dist(b, table))[0]
    let best = null
    this.metrics.queries++
    for (const table of this.places.values()) {
      if (table.kind !== 'crafting_table' || table.dim !== dim || table.status === STATUS.INVALIDATED || table.skipUntil > t) continue
      const d = dist(table, from)
      if (d > maxDistance) continue
      const wood = near('wood', table), stone = near('stone', table)
      if (!wood || !stone) continue
      if (!best || d < best.distance) best = { table, wood, stone, distance: d }
    }
    if (best) {
      for (const p of [best.table, best.wood, best.stone]) p.suggested = true
      this.log(`suggest preparation_site ${dim} table=(${best.table.x},${best.table.y},${best.table.z}) d=${Math.round(best.distance)}`)
    }
    return best
  }

  // ---------- landmarks vindos dos providers ----------
  landmark(kind) {
    const p = this.providers[kind]?.()
    if (!p || !Number.isFinite(Number(p.x))) return null
    const c = this.landmarkConfirmations[kind]
    return { kind, x: Number(p.x), y: Number(p.y), z: Number(p.z), dimension: normalizeDimension(p.dimension), lastConfirmedAt: c?.t ?? null }
  }

  confirmLandmark(kind) {
    const lm = this.landmark(kind)
    if (!lm) return null
    this.landmarkConfirmations[kind] = { t: this.now(), x: lm.x, y: lm.y, z: lm.z }
    this._markDirty()
    return lm
  }

  // ---------- limites ----------
  _evict() {
    if (this.places.size <= this.opts.maxPlaces) return
    const t = this.now()
    const rank = (p) => (p.status === STATUS.INVALIDATED ? 0 : this.effectiveStatus(p) === STATUS.STALE ? 1 : 2)
    for (const [k, p] of this.places) if (p.status === STATUS.INVALIDATED && t - p.invalidatedAt > this.opts.tombstoneMs) this.places.delete(k)
    if (this.places.size <= this.opts.maxPlaces) return
    const sorted = [...this.places.values()].sort((a, b) => rank(a) - rank(b) || a.lastSeenAt - b.lastSeenAt)
    for (const p of sorted.slice(0, this.places.size - this.opts.maxPlaces)) this.places.delete(p.key)
  }

  _evictExplored() {
    const sorted = [...this.explored.entries()].sort((a, b) => a[1].t - b[1].t)
    for (const [k] of sorted.slice(0, this.explored.size - this.opts.maxExplored)) this.explored.delete(k)
  }

  // ---------- relatório ----------
  summary(dimension = null) {
    const byKind = {}
    for (const p of this.places.values()) {
      if (dimension && p.dim !== normalizeDimension(dimension)) continue
      const s = this.effectiveStatus(p)
      const row = (byKind[p.kind] ||= { CONFIRMED: 0, STALE: 0, INVALIDATED: 0 })
      row[s]++
    }
    return { places: this.places.size, explored: this.explored.size, byKind, metrics: { ...this.metrics }, session: { created: this.session.created, confirmed: this.session.confirmed, invalidated: this.session.invalidated }, loadStatus: this.loadStatus, readOnly: this.readOnly }
  }
}

module.exports = { WorldMemory, STATUS, VERSION, normalizeDimension, placeKey, chunkOf, BLOCK_KINDS, HAZARD_KINDS }
