const fs = require('fs')
const path = require('path')

function point(value) {
  if (!value) return null
  const x = Number(value.x)
  const y = Number(value.y)
  const z = Number(value.z)
  if (![x, y, z].every(Number.isFinite)) return null
  return { x, y, z }
}


function animalTargets(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [species, raw] of Object.entries(value)) {
    const target = Number.parseInt(raw, 10)
    if (!species || !Number.isInteger(target)) continue
    out[species] = Math.max(2, Math.min(32, target))
  }
  return out
}

class StateStore {
  constructor(filePath = process.env.COLONY_STATE_FILE || '.data/colony-state.json') {
    this.filePath = path.resolve(filePath)
    this._write = Promise.resolve()
    this.lastLoadError = null
  }

  defaults() {
    return {
      version: 1,
      home: null,
      homeDimension: null,
      storage: null,
      auto: false,
      companionAuto: false,
      waypoints: {},
      workers: {},
      project: null,
      animalTargets: {},
      updatedAt: null
    }
  }

  async load() {
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw)
      return {
        ...this.defaults(),
        ...parsed,
        home: point(parsed.home),
        homeDimension: parsed.homeDimension == null ? null : String(parsed.homeDimension),
        storage: point(parsed.storage),
        waypoints: parsed.waypoints && typeof parsed.waypoints === 'object' && !Array.isArray(parsed.waypoints)
          ? parsed.waypoints
          : {},
        workers: parsed.workers && typeof parsed.workers === 'object' ? parsed.workers : {},
        animalTargets: animalTargets(parsed.animalTargets)
      }
    } catch (err) {
      if (err.code === 'ENOENT') return this.defaults()
      if (err instanceof SyntaxError) {
        this.lastLoadError = err
        return this.defaults()
      }
      throw err
    }
  }

  async save(state) {
    const data = {
      ...this.defaults(),
      ...state,
      home: point(state.home),
      storage: point(state.storage),
      animalTargets: animalTargets(state.animalTargets),
      updatedAt: new Date().toISOString()
    }

    const run = async () => {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.tmp-${process.pid}`
      await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
      await fs.promises.rename(tmp, this.filePath)
      return data
    }

    this._write = this._write.then(run, run)
    return this._write
  }
}

module.exports = { StateStore, point, animalTargets }
