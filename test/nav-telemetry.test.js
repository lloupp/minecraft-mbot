const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const telemetry = require('../lib/nav-telemetry')

function fakeBot() {
  const bot = new EventEmitter()
  bot.pathfinder = { setGoal() {} }
  return bot
}

test('registra path_update, noPath e limpa a falha no sucesso', () => {
  const bot = fakeBot()
  telemetry.attach(bot)
  bot.emit('path_update', { status: 'noPath' })
  assert.equal(telemetry.lastFailure(bot).code, 'PATH_NO_PATH')
  assert.equal(telemetry.snapshot(bot).counts.noPath, 1)
  bot.emit('path_update', { status: 'success' })
  assert.equal(telemetry.lastFailure(bot), null)
  assert.equal(telemetry.snapshot(bot).lastStatus, 'success')
})

test('aceita payload em string e timeout', () => {
  const bot = fakeBot()
  telemetry.attach(bot)
  bot.emit('path_update', 'timeout')
  const snapshot = telemetry.snapshot(bot)
  assert.equal(snapshot.lastStatus, 'timeout')
  assert.equal(snapshot.counts.timeout, 1)
  assert.equal(telemetry.lastFailure(bot).code, 'PATH_TIMEOUT')
})

test('path_reset relevante vira falha; reset intencional não', () => {
  const bot = fakeBot()
  telemetry.attach(bot)
  bot.emit('path_reset', 'goal_updated')
  assert.equal(telemetry.lastFailure(bot), null)
  bot.emit('path_reset', 'stuck')
  assert.deepEqual(
    { code: telemetry.lastFailure(bot).code, reason: telemetry.lastFailure(bot).reason },
    { code: 'PATH_STUCK', reason: 'stuck' }
  )
  assert.equal(telemetry.snapshot(bot).counts.resets, 2)
})

test('goal_reached limpa a última falha e conta chegadas', () => {
  const bot = fakeBot()
  telemetry.attach(bot)
  bot.emit('path_update', { status: 'noPath' })
  bot.emit('goal_reached')
  assert.equal(telemetry.lastFailure(bot), null)
  assert.equal(telemetry.snapshot(bot).counts.reached, 1)
})

test('attach é idempotente e não duplica contagem', () => {
  const bot = fakeBot()
  telemetry.attach(bot)
  telemetry.attach(bot)
  bot.emit('path_update', { status: 'partial' })
  assert.equal(telemetry.snapshot(bot).counts.partial, 1)
})

test('sem bot ou sem eventos não lança', () => {
  assert.equal(telemetry.attach(null), null)
  assert.equal(telemetry.snapshot(null), null)
  assert.equal(telemetry.lastFailure({}), null)
  const bot = {}
  assert.equal(telemetry.attach(bot), null)
})
