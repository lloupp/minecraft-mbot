// lib/dashboard-snapshot.js
// Monta o retrato que o painel mostra, só com dados que já existem nos bots
// Mineflayer reais: posição, dimensão, vida/fome, inventário e tarefa.

const MAX_LOG_LINES = 300
const MAX_LOG_CHARS = 500
const SECRET_IN_TEXT = /\b(token|password|senha|secret|authorization|cookie|api[_-]?key)\b(\s*[:=]\s*)\S+/gi

function round(value) {
  return Math.round(value * 100) / 100
}

function dimensionOf(bot) {
  const value = bot?.game?.dimension
  if (value == null) return null
  if (typeof value === 'string') return value
  if (typeof value?.name === 'string') return value.name
  return String(value)
}

function inventoryOf(bot) {
  const items = bot?.inventory?.items?.() || []
  return items.slice(0, 46).map((item) => ({ slot: item.slot, name: item.name, count: item.count }))
}

// Um bot Mineflayer (principal ou worker) visto de fora.
function describeBot(bot, extra = {}) {
  const entity = bot?.entity
  return {
    name: bot?.username || extra.name || null,
    connected: Boolean(entity),
    position: entity ? { x: round(entity.position.x), y: round(entity.position.y), z: round(entity.position.z) } : null,
    dimension: entity ? dimensionOf(bot) : null,
    health: entity && Number.isFinite(bot.health) ? round(bot.health) : null,
    food: entity && Number.isFinite(bot.food) ? bot.food : null,
    gameMode: bot?.game?.gameMode ?? null,
    inventory: entity ? inventoryOf(bot) : [],
    ...extra
  }
}

function describeWorkers(botManager) {
  const workers = botManager?.workers instanceof Map ? [...botManager.workers.values()] : []
  return workers.map((worker) => {
    const controller = worker.bot?.colonyController
    const task = controller?.currentTask || null
    return describeBot(worker.bot, {
      name: worker.name,
      role: worker.role,
      status: controller?.state || worker.status,
      task: task ? { type: task.type || null, resource: task.resource || null, count: task.count ?? null } : null,
      createdAt: worker.createdAt || null
    })
  })
}

// Últimas linhas do console para o painel (o terminal continua recebendo tudo).
class ConsoleBuffer {
  constructor(limit = MAX_LOG_LINES) {
    this.limit = limit
    this.lines = []
    this.seq = 0
    this.restore = null
  }

  push(level, args) {
    const text = args.map((arg) => (typeof arg === 'string' ? arg : safeString(arg))).join(' ')
      .replace(SECRET_IN_TEXT, '$1$2[redacted]')
      .slice(0, MAX_LOG_CHARS)
    this.lines.push({ seq: ++this.seq, time: new Date().toISOString(), level, text })
    if (this.lines.length > this.limit) this.lines.splice(0, this.lines.length - this.limit)
  }

  recent(n = 200) {
    return this.lines.slice(-Math.max(0, Math.min(n, this.limit)))
  }

  // Espelha console.log/warn/error no buffer sem mudar o que sai no terminal.
  capture(target = console) {
    if (this.restore) return this
    const originals = {}
    for (const [method, level] of [['log', 'info'], ['warn', 'warn'], ['error', 'error']]) {
      originals[method] = target[method]
      target[method] = (...args) => {
        try { this.push(level, args) } catch {}
        return originals[method].apply(target, args)
      }
    }
    this.restore = () => {
      Object.assign(target, originals)
      this.restore = null
    }
    return this
  }
}

function safeString(value) {
  if (value instanceof Error) return value.stack || value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

module.exports = { describeBot, describeWorkers, dimensionOf, ConsoleBuffer, MAX_LOG_LINES, MAX_LOG_CHARS }
