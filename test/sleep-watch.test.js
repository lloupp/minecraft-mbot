const test = require('node:test')
const assert = require('node:assert/strict')

const sleepWatch = require('../lib/sleep-watch')

function fakeBot({ me = 'eduardo_bot', players = {}, bed = null } = {}) {
  return {
    username: me,
    players,
    blockAt: (pos) => (bed && pos && pos.y === bed.y ? { name: bed.name } : { name: 'air' })
  }
}

const at = (x, y, z) => ({ x, y, z })

test('reconhece pedido de dormir em português e inglês', () => {
  for (const message of ['vou dormir', 'Boa noite!', 'bora dormir galera', 'sleeping now', 'going to bed']) {
    assert.equal(sleepWatch.isSleepMessage(message), true, message)
  }
})

test('ignora conversa comum', () => {
  for (const message of ['oi', 'traz lapis', 'me ajuda a minerar', '']) {
    assert.equal(sleepWatch.isSleepMessage(message), false, message)
  }
})

test('detecta jogador dormindo pelo estado da entidade', () => {
  const bot = fakeBot({ players: { Eduardo: { entity: { position: at(0, 64, 0), sleeping: true } } } })
  assert.deepEqual(sleepWatch.sleepingOthers(bot), [{ name: 'Eduardo', why: 'dormindo' }])
})

test('detecta jogador deitado numa cama', () => {
  const bot = fakeBot({ players: { Eduardo: { entity: { position: at(0, 64, 0) } } }, bed: { y: 64, name: 'red_bed' } })
  assert.deepEqual(sleepWatch.sleepingOthers(bot), [{ name: 'Eduardo', why: 'deitado na cama' }])
})

test('não considera jogador em pé no chão', () => {
  const bot = fakeBot({ players: { Eduardo: { entity: { position: at(0, 64, 0) } } }, bed: { y: 70, name: 'red_bed' } })
  assert.deepEqual(sleepWatch.sleepingOthers(bot), [])
})

test('nunca considera o próprio bot, workers ou jogadores sem entidade', () => {
  const bot = fakeBot({
    players: {
      eduardo_bot: { entity: { position: at(0, 64, 0), sleeping: true } },
      fazendeiro_01: { entity: { position: at(1, 64, 1), sleeping: true } },
      Ausente: {}
    }
  })
  assert.deepEqual(sleepWatch.sleepingOthers(bot, { skip: (name) => name === 'fazendeiro_01' }), [])
})

test('quebra quando blockAt falha em vez de derrubar o bot', () => {
  const bot = { username: 'eduardo_bot', players: { Eduardo: { entity: { position: at(0, 64, 0) } } }, blockAt: () => { throw new Error('chunk não carregado') } }
  assert.deepEqual(sleepWatch.sleepingOthers(bot), [])
})
