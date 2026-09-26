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
      storage: null,
      auto: false,
      companionAuto: false,
      workers: {},
      project: null,
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
        storage: point(parsed.storage),
        workers: parsed.workers && typeof parsed.workers === 'object' ? parsed.workers : {}
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

module.exports = { StateStore, point }
