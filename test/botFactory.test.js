const test = require('node:test')
const assert = require('node:assert/strict')
const { createBot } = require('../lib/botFactory')

test('cada cliente recebe configuração própria após Mineflayer alterar opções', () => {
  const config = { host: '127.0.0.1', port: 25565, username: 'eduardo_bot', version: '1.20.1' }
  const received = []
  const mineflayer = {
    createBot(options) {
      received.push({ options, connect: options.connect, client: options.client })
      // minecraft-protocol acrescenta estes campos durante a criação do cliente.
      options.auth = 'offline'
      options.connect = () => {}
      options.client = {}
      return {}
    }
  }

  createBot(mineflayer, config)
  createBot(mineflayer, config, { username: 'minerador_01' })

  assert.notEqual(received[0].options, received[1].options)
  assert.equal(received[0].options.username, 'eduardo_bot')
  assert.equal(received[1].options.username, 'minerador_01')
  assert.equal(received[1].connect, undefined)
  assert.equal(received[1].client, undefined)
  assert.equal(config.connect, undefined)
  assert.equal(config.client, undefined)
})
