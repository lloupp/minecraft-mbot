const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { Invincibility, enabled, commandsFor, isProtected } = require('../lib/invincible')

const registry = { effectsByName: { Resistance: { id: 11 }, Saturation: { id: 23 }, FireResistance: { id: 12 }, WaterBreathing: { id: 13 } } }
const now = (fn) => { fn(); return 0 }
const noRepeat = () => null

function chatBot() {
  const bot = new EventEmitter()
  bot.username = 'eduardo_bot'
  bot.sent = []
  bot.chat = (text) => bot.sent.push(text)
  return bot
}

test('desligado por padrão; liga com MBOT_INVINCIBLE=1', () => {
  assert.equal(enabled({}), false)
  assert.equal(enabled({ MBOT_INVINCIBLE: '1' }), true)
})

test('comandos de efeito infinito para o nome', () => {
  const cmds = commandsFor('minerador_01')
  assert.equal(cmds.length, 4)
  assert.ok(cmds.includes('/effect give minerador_01 minecraft:resistance infinite 4 true'))
  assert.ok(cmds.includes('/effect give minerador_01 minecraft:saturation infinite 0 true'))
})

test('isProtected confere os efeitos que o próprio bot tem', () => {
  const bot = { registry, entity: { effects: {} } }
  assert.equal(isProtected(bot), false)
  bot.entity.effects = { 11: { amplifier: 4 }, 23: { amplifier: 0 }, 12: { amplifier: 0 }, 13: { amplifier: 0 } }
  assert.equal(isProtected(bot), true)
  bot.entity.effects[11] = { amplifier: 1 } // resistência fraca não basta
  assert.equal(isProtected(bot), false)
})

test('ajudante que entra (e renasce) recebe os efeitos', async () => {
  const main = chatBot()
  const inv = new Invincibility({ commander: () => main, log: () => {}, setTimer: now, setRepeat: noRepeat })
  const worker = new EventEmitter()
  inv.watch(worker, 'minerador_01')
  worker.emit('spawn')
  await inv.queue
  assert.equal(main.sent.length, 4)
  worker.emit('spawn') // renasceu
  await inv.queue
  assert.equal(main.sent.length, 8)
})

test('checagem periódica reaplica só em quem perdeu efeito', async () => {
  const main = chatBot()
  const inv = new Invincibility({ commander: () => main, log: () => {}, setTimer: now, setRepeat: noRepeat })
  const ok = { registry, health: 20, entity: { effects: { 11: { amplifier: 4 }, 23: {}, 12: {}, 13: {} } }, on: () => {}, once: () => {} }
  const lost = { registry, health: 20, entity: { effects: {} }, on: () => {}, once: () => {} }
  inv.watched.set('ok', ok)
  inv.watched.set('perdeu', lost)
  inv.checkAll()
  await inv.queue
  assert.ok(main.sent.every((c) => c.includes(' perdeu ')))
  assert.equal(main.sent.length, 4)
})

test('sem permissão: avisa uma vez e para de insistir', async () => {
  const main = chatBot()
  const logs = []
  const inv = new Invincibility({ commander: () => main, log: (t) => logs.push(t), setTimer: (fn) => { main.emit('messagestr', 'You do not have permission to use this command'); fn() }, setRepeat: noRepeat })
  await inv.protect('minerador_01')
  assert.equal(inv.noPermission, true)
  assert.equal(logs.filter((l) => l.includes('/op eduardo_bot')).length, 1)
  inv.watched.set('x', { registry, health: 20, entity: { effects: {} } })
  main.sent.length = 0
  inv.checkAll()
  await inv.queue
  assert.equal(main.sent.length, 0)
})
