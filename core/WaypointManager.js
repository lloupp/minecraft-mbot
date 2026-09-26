const MAX_WAYPOINTS = 64

function normalizeWaypointName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

function waypointPoint(value) {
  if (!value) return null
  const x = Number(value.x)
  const y = Number(value.y)
  const z = Number(value.z)
  if (![x, y, z].every(Number.isFinite)) return null
  return { x, y, z }
}

function normalizeDimension(value) {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (typeof value?.name === 'string') return value.name
  return String(value)
}

class WaypointManager {
  constructor(initial = {}) {
    this.points = new Map()
    this.restore(initial)
  }

  restore(initial = {}) {
    this.points.clear()
    if (!initial || typeof initial !== 'object' || Array.isArray(initial)) return
    for (const [rawName, raw] of Object.entries(initial)) {
      const name = normalizeWaypointName(rawName)
      const position = waypointPoint(raw?.position || raw)
      if (!name || !position) continue
      this.points.set(name, {
        name,
        position,
        dimension: normalizeDimension(raw?.dimension),
        createdAt: raw?.createdAt || null
      })
      if (this.points.size >= MAX_WAYPOINTS) break
    }
  }

  save(name, position, dimension = null) {
    const normalized = normalizeWaypointName(name)
    if (!normalized) throw new Error('nome de local inválido')
    const point = waypointPoint(position)
    if (!point) throw new Error('posição inválida')
    if (!this.points.has(normalized) && this.points.size >= MAX_WAYPOINTS) {
      throw new Error(`limite de ${MAX_WAYPOINTS} locais atingido`)
    }

    const entry = {
      name: normalized,
      position: point,
      dimension: normalizeDimension(dimension),
      createdAt: new Date().toISOString()
    }
    this.points.set(normalized, entry)
    return { ...entry, position: { ...entry.position } }
  }

  get(name) {
    const normalized = normalizeWaypointName(name)
    const entry = this.points.get(normalized)
    return entry ? { ...entry, position: { ...entry.position } } : null
  }

  remove(name) {
    return this.points.delete(normalizeWaypointName(name))
  }

  list() {
    return [...this.points.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({ ...entry, position: { ...entry.position } }))
  }

  exportState() {
    return Object.fromEntries(this.list().map((entry) => [
      entry.name,
      {
        position: { ...entry.position },
        dimension: entry.dimension,
        createdAt: entry.createdAt
      }
    ]))
  }

  sameDimension(entry, dimension) {
    const current = normalizeDimension(dimension)
    return !entry?.dimension || !current || entry.dimension === current
  }
}

module.exports = {
  WaypointManager,
  normalizeWaypointName,
  normalizeDimension,
  waypointPoint,
  MAX_WAYPOINTS
}
