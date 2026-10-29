// lib/invincible.js
// Bots invencíveis no modo sobrevivência (opt-in: MBOT_INVINCIBLE=1).
// O bot principal dá efeitos infinitos a si mesmo e a cada ajudante quando ele
// entra no mundo (inclusive depois de morrer) e confere de tempos em tempos.
// Continua em sobrevivência, então o que eles quebram solta item normalmente.
//
// Precisa que o bot principal seja operador no servidor (/op eduardo_bot).

// [efeito, nível (0 = I), id no registro 1.20.1]
const EFFECTS = [
  ['resistance', 4, 'Resistance'], // nível V: bloqueia dano de mob, queda e explosão
  ['saturation', 0, 'Saturation'], // fome sempre cheia
  ['fire_resistance', 0, 'FireResistance'],
  ['water_breathing', 0, 'WaterBreathing']
]
const CHECK_MS = 60000
const SPAWN_DELAY_MS = 2000
const COMMAND_GAP_MS = 400
const NO_PERMISSION = /permission|not allowed|unknown or incomplete command|unknown command|n[aã]o tem permiss/i

function enabled(env = process.env) {
  return String(env?.MBOT_INVINCIBLE ?? '') === '1'
}

function commandsFor(name) {
  return EFFECTS.map(([effect, level]) => `/effect give ${name} minecraft:${effect} infinite ${level} true`)
}

// O próprio bot sabe quais efeitos tem (mineflayer guarda em entity.effects por id).
function isProtected(bot) {
  const effects = bot?.entity?.effects
  if (!effects) return false
  const byName = bot.registry?.effectsByName || {}
  return EFFECTS.every(([, level, key]) => {
    const id = byName[key]?.id
    if (id == null) return true // efeito desconhecido nesta versão: não bloqueia
    const effect = effects[id]
    return Boolean(effect) && (effect.amplifier ?? 0) >= level
  })
}

class Invincibility {
  constructor({ commander, log = console.log, setTimer = setTimeout, setRepeat = setInterval, checkMs = CHECK_MS, spawnDelayMs = SPAWN_DELAY_MS, gapMs = COMMAND_GAP_MS } = {}) {
    this.commander = commander // função -> bot principal (quem manda os comandos)
    this.log = log
    this.setTimer = setTimer
    this.gapMs = gapMs
    this.spawnDelayMs = spawnDelayMs
    this.watched = new Map() // nome -> bot
    this.queue = Promise.resolve()
    this.noPermission = false
    this.listening = null
    this.timer = setRepeat(() => this.checkAll(), checkMs)
    this.timer?.unref?.()
  }

  // Avisa uma vez se o servidor recusar os comandos.
  listen(chatBot) {
    if (!chatBot || this.listening === chatBot) return
    this.listening = chatBot
    chatBot.on?.('messagestr', (text) => {
      if (this.noPermission || !this.pending || !NO_PERMISSION.test(String(text))) return
      this.noPermission = true
      this.log(`[invencível] o servidor recusou /effect ("${String(text).slice(0, 80)}"). Peça ao admin: /op ${chatBot.username}`)
    })
  }

  protect(name) {
    const chatBot = this.commander?.()
    if (!chatBot?.chat || !name) return this.queue
    this.listen(chatBot)
    this.queue = this.queue.then(async () => {
      this.pending = true
      for (const command of commandsFor(name)) {
        chatBot.chat(command)
        await new Promise((resolve) => this.setTimer(resolve, this.gapMs))
      }
      this.pending = false
      this.log(`[invencível] efeitos aplicados em ${name}`)
    }).catch((err) => this.log(`[invencível] ${name}: ${err.message}`))
    return this.queue
  }

  // Protege ao entrar no mundo e a cada renascimento.
  watch(bot, name) {
    if (!bot || !name) return
    this.watched.set(name, bot)
    const onSpawn = () => this.setTimer(() => this.protect(name), this.spawnDelayMs)
    bot.on?.('spawn', onSpawn)
    bot.once?.('end', () => {
      if (this.watched.get(name) === bot) this.watched.delete(name)
    })
    if (bot.entity) onSpawn()
  }

  // Reaplica em quem perdeu algum efeito (leite, morte não notada, comando /effect clear).
  checkAll() {
    if (this.noPermission) return
    for (const [name, bot] of this.watched) {
      if (bot.entity && bot.health > 0 && !isProtected(bot)) this.protect(name)
    }
  }

  stop() {
    clearInterval(this.timer)
  }
}

module.exports = { Invincibility, enabled, commandsFor, isProtected, EFFECTS }
