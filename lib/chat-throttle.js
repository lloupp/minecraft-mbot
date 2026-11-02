// lib/chat-throttle.js
// Fila de chat que respeita o anti-spam do servidor vanilla.
//
// O servidor soma 20 por mensagem a um contador que cai 1 por tick (20/s) e
// expulsa o jogador ("Kicked for spamming") quando passa de 200. O mineflayer
// manda todos os pedaços de uma mensagem longa de uma vez: o !ajuda (4 linhas
// longas) bastava para derrubar o bot. Aqui o mesmo contador é simulado e cada
// mensagem espera o necessário para ele ficar abaixo de `maxLevel`.

const COST = 20
const DECAY_PER_MS = 20 / 1000
const DEFAULT_MAX_LEVEL = 160 // folga abaixo do limite de 200
const LENGTH_LIMIT = 256

// Quebra em pedaços de até `limit` caracteres, sem cortar palavras quando dá.
function splitMessage(text, limit = LENGTH_LIMIT) {
  const parts = []
  for (const line of String(text).split('\n')) {
    let rest = line.trim()
    while (rest.length > limit) {
      let cut = rest.lastIndexOf(' ', limit)
      if (cut <= 0) cut = limit
      parts.push(rest.slice(0, cut).trimEnd())
      rest = rest.slice(cut).trimStart()
    }
    if (rest) parts.push(rest)
  }
  return parts
}

// O plugin de chat do mineflayer só cria bot.chat depois do login: sem ele
// ainda, a fila é instalada no evento 'login'.
function throttleChat(bot, options = {}) {
  if (typeof bot.chat === 'function') return install(bot, options)
  bot.once('login', () => install(bot, options))
  return bot
}

function install(bot, { maxLevel = DEFAULT_MAX_LEVEL, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const send = bot.chat.bind(bot)
  const queue = []
  let level = 0
  let levelAt = now()
  let timer = null

  const currentLevel = () => {
    const t = now()
    level = Math.max(0, level - (t - levelAt) * DECAY_PER_MS)
    levelAt = t
    return level
  }

  function pump() {
    timer = null
    while (queue.length) {
      const wait = (currentLevel() + COST - maxLevel) / DECAY_PER_MS
      if (wait > 0) {
        timer = setTimer(pump, Math.ceil(wait))
        timer?.unref?.()
        return
      }
      level += COST
      try { send(queue.shift()) } catch { /* conexão caiu: o restante da fila não importa */ }
    }
  }

  bot.chat = (message) => {
    const text = typeof message === 'number' ? String(message) : message
    // Comandos (/tell, /msg...) não são quebrados, como no mineflayer.
    const parts = typeof text === 'string' && text.startsWith('/') ? [text] : splitMessage(text)
    queue.push(...parts)
    if (!timer) pump()
  }
  bot.chat.pending = () => queue.length

  bot.once?.('end', () => {
    queue.length = 0
    if (timer) clearTimer(timer)
    timer = null
  })
  return bot
}

module.exports = { throttleChat, splitMessage, COST, DEFAULT_MAX_LEVEL }
