const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { throttleChat, splitMessage } = require('../lib/chat-throttle')

// Relógio falso: timers só disparam quando o teste avança o tempo.
function fakeClock() {
  let t = 0
  const timers = []
  return {
    now: () => t,
    setTimer: (fn, ms) => { const timer = { at: t + ms, fn }; timers.push(timer); return timer },
    clearTimer: (timer) => { const i = timers.indexOf(timer); if (i >= 0) timers.splice(i, 1) },
    advance(ms) {
      const end = t + ms
      for (;;) {
        timers.sort((a, b) => a.at - b.at)
        const next = timers[0]
        if (!next || next.at > end) break
        timers.shift()
        t = next.at
        next.fn()
      }
      t = end
    }
  }
}

function setup() {
  const clock = fakeClock()
  const bot = new EventEmitter()
  const sent = []
  bot.chat = (text) => sent.push({ at: clock.now(), text })
  throttleChat(bot, clock)
  return { bot, sent, clock }
}

// Reproduz o contador do servidor vanilla e diz se o bot seria expulso.
function wouldBeKicked(sent) {
  let level = 0
  let last = 0
  for (const { at } of sent) {
    level = Math.max(0, level - (at - last) / 50)
    last = at
    level += 20
    if (level > 200) return true
  }
  return false
}

test('splitMessage quebra por palavras em até 256 caracteres', () => {
  const words = Array.from({ length: 80 }, (_, i) => `!comando${i},`).join(' ')
  const parts = splitMessage(words)
  assert.ok(parts.length > 1)
  assert.ok(parts.every((p) => p.length <= 256))
  assert.equal(parts.join(' '), words)
  assert.deepEqual(splitMessage('a\n\nb'), ['a', 'b'])
  assert.equal(splitMessage('x'.repeat(600)).length, 3)
})

test('mensagens curtas e poucas saem na hora', () => {
  const { bot, sent } = setup()
  bot.chat('oi')
  bot.chat('tudo bem')
  assert.deepEqual(sent.map((s) => s.text), ['oi', 'tudo bem'])
})

test('rajada grande espera em vez de ser expulsa, mantendo a ordem', () => {
  const { bot, sent, clock } = setup()
  for (let i = 0; i < 30; i++) bot.chat(`linha ${i}`)
  assert.equal(sent.length, 8)
  assert.equal(bot.chat.pending(), 22)
  clock.advance(60000)
  assert.equal(sent.length, 30)
  assert.deepEqual(sent.map((s) => s.text), Array.from({ length: 30 }, (_, i) => `linha ${i}`))
  assert.equal(wouldBeKicked(sent), false)
})

test('o !ajuda real não estoura o anti-spam', () => {
  const { bot, sent, clock } = setup()
  const long = Array.from({ length: 30 }, (_, i) => `!comando${i}`).join(', ')
  for (let i = 0; i < 3; i++) { bot.chat(long); bot.chat(long); bot.chat('curta') }
  clock.advance(60000)
  assert.equal(wouldBeKicked(sent), false)
  // Sem a fila, as mesmas mensagens no mesmo instante derrubariam o bot.
  assert.equal(wouldBeKicked(sent.map((s) => ({ ...s, at: 0 }))), true)
})

test('fim da conexão descarta a fila pendente', () => {
  const { bot, sent, clock } = setup()
  for (let i = 0; i < 20; i++) bot.chat(`m${i}`)
  bot.emit('end')
  clock.advance(60000)
  assert.equal(sent.length, 8)
})

test('bot real: bot.chat só existe depois do login; a fila entra nessa hora', () => {
  const clock = fakeClock()
  const bot = new EventEmitter()
  const sent = []
  throttleChat(bot, clock)
  assert.equal(bot.chat, undefined)
  bot.chat = (text) => sent.push({ at: clock.now(), text }) // o plugin de chat do mineflayer
  bot.emit('login')
  for (let i = 0; i < 12; i++) bot.chat(`m${i}`)
  assert.equal(sent.length, 8)
  assert.equal(typeof bot.chat.pending, 'function')
})
