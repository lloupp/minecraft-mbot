const ROLE_ALIASES = {
  minerador: 'minerador',
  miner: 'minerador',
  lenhador: 'lenhador',
  lumberjack: 'lenhador',
  fazendeiro: 'fazendeiro',
  farmer: 'fazendeiro',
  construtor: 'construtor',
  builder: 'construtor',
  explorador: 'explorador',
  explorer: 'explorador',
  guarda: 'guarda',
  guard: 'guarda',
  ajudante: 'ajudante',
  helper: 'ajudante'
}

class BotManager {
  constructor({ createBot, orchestratorName = 'eduardo_bot', maxBots = 12 }) {
    if (typeof createBot !== 'function') throw new Error('createBot é obrigatório')
    this.createBot = createBot
    this.orchestratorName = orchestratorName
    this.maxBots = maxBots
    this.workers = new Map()
    this.sequence = new Map()
  }

  normalizeRole(role) {
    return ROLE_ALIASES[String(role || 'ajudante').toLowerCase()] || null
  }

  capacity() {
    return Math.max(0, this.maxBots - 1 - this.workers.size)
  }

  nextName(role) {
    const next = (this.sequence.get(role) || 0) + 1
    this.sequence.set(role, next)
    return `${role}_${String(next).padStart(2, '0')}`
  }

  async create(role = 'ajudante', count = 1) {
    const normalized = this.normalizeRole(role)
    if (!normalized) throw new Error(`papel desconhecido: ${role}`)

    const capacity = this.capacity()
    if (capacity <= 0) throw new Error(`limite da colônia atingido (${this.maxBots} bots contando o orquestrador)`)
    const requested = Math.max(1, Math.min(Number(count) || 1, capacity))

    const created = []
    for (let i = 0; i < requested; i++) {
      const name = this.nextName(normalized)
      const bot = await this.createBot({ name, role: normalized })
      const worker = { name, role: normalized, bot, status: 'conectando', createdAt: Date.now() }
      this.workers.set(name, worker)
      created.push(worker)

      bot.once?.('spawn', () => { worker.status = 'ativo' })
      bot.once?.('end', () => {
        worker.status = 'desconectado'
        this.workers.delete(name)
      })
      bot.on?.('error', () => { worker.status = 'erro' })
    }
    return created
  }

  list() {
    return [...this.workers.values()].map(({ name, role, status, createdAt }) => ({
      name, role, status, createdAt
    }))
  }

  get(name) {
    return this.workers.get(name) || null
  }

  remove(name) {
    const worker = this.workers.get(name)
    if (!worker) return false
    worker.bot.quit?.()
    this.workers.delete(name)
    return true
  }

  stopAll() {
    for (const worker of this.workers.values()) worker.bot.quit?.()
    this.workers.clear()
  }
}

module.exports = { BotManager, ROLE_ALIASES }
