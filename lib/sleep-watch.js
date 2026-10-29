// lib/sleep-watch.js
// Desligar o bot quando os outros jogadores forem dormir. Um bot acordado
// impede a noite de passar para quem está na cama; sair com código 0 evita que
// o supervisor o reconecte sozinho.

// Pedido explícito no chat (português e inglês).
const SLEEP_WORDS = /(\bdormir\b|\bdurmo\b|\bdormindo\b|\bboa noite\b|\bsleep\b|\bsleeping\b|\bgoing to bed\b)/i

function isSleepMessage(message) {
  const text = String(message ?? '').trim()
  if (!text) return false
  return SLEEP_WORDS.test(text)
}

const isBed = (block) => Boolean(block && typeof block.name === 'string' && block.name.endsWith('_bed'))

// Jogadores reais deitados (o bot e os workers ficam de fora): `sleeping`
// quando a versão do mineflayer expõe o estado, ou em cima de uma cama.
function sleepingOthers(bot, { skip = () => false, blockAt = null } = {}) {
  const found = []
  for (const [name, player] of Object.entries(bot.players || {})) {
    if (!player || name === bot.username || skip(name)) continue
    const entity = player.entity
    if (!entity || !entity.position) continue
    if (entity.sleeping === true) {
      found.push({ name, why: 'dormindo' })
      continue
    }
    let block = null
    try {
      block = (blockAt || bot.blockAt)?.(entity.position) || null
    } catch {
      block = null
    }
    if (isBed(block)) found.push({ name, why: 'deitado na cama' })
  }
  return found
}

module.exports = { isSleepMessage, sleepingOthers, isBed, SLEEP_WORDS }
