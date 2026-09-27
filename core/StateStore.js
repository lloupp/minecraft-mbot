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
      routeMemory: null,
      deathRecords: {},
      updatedAt: null
    }
  }

  async load() {
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version !== 1) {
        const err = new Error('Estado incompatível: esperado version=1; migração explícita necessária')
        err.code = 'STATE_SCHEMA_UNSUPPORTED'
        throw err
      }
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
      if (err instanceof SyntaxError || err.code === 'STATE_SCHEMA_UNSUPPORTED') {
        this.lastLoadError = err
        return this.defaults()
      }
      throw err
    }
  }

  async save(state) {
    // Não apagar a única evidência de corrupção/incompatibilidade no próximo autosave.
    if (this.lastLoadError) {
      const err = new Error('Salvamento bloqueado: preserve e recupere o arquivo de estado inválido antes de reiniciar')
      err.code = 'STATE_RECOVERY_REQUIRED'
      throw err
    }
    const data = {
      ...this.defaults(),
      ...state,
      version: 1,
      home: point(state.home),
      storage: point(state.storage),
      animalTargets: animalTargets(state.animalTargets),
      routeMemory: state.routeMemory || null,
      deathRecords: state.deathRecords || {},
      updatedAt: new Date().toISOString()
    }

    const run = async () => {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.tmp-${process.pid}`
      try {
        await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
        const written = JSON.parse(await fs.promises.readFile(tmp, 'utf8'))
        if (written.version !== 1) throw new Error('Versão inválida no arquivo temporário')
        await fs.promises.rename(tmp, this.filePath)
      } finally {
        await fs.promises.rm(tmp, { force: true })
      }
      return data
    }

    this._write = this._write.then(run, run)
    return this._write
  }
}

module.exports = { StateStore, point, animalTargets }
