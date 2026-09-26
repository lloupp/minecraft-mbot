const test = require('node:test')
const assert = require('node:assert/strict')

const { lanMessage, motdText } = require('../lib/lan')

test('mensagem no formato que o cliente Minecraft reconhece', () => {
  assert.equal(lanMessage('Mundo do eduardo', 25565).toString(), '[MOTD]Mundo do eduardo[/MOTD][AD]25565[/AD]')
})

test('remove colchetes do MOTD para não quebrar o parser', () => {
  assert.equal(lanMessage('[Bot] casa', 25565).toString(), '[MOTD]Bot casa[/MOTD][AD]25565[/AD]')
})

test('extrai o texto do MOTD em string, componente e NBT', () => {
  assert.equal(motdText('Oi'), 'Oi')
  assert.equal(motdText({ text: 'Mundo', extra: [{ text: ' do bot' }] }), 'Mundo do bot')
  assert.equal(motdText({ type: 'string', value: 'Mundo do eduardo (com bot)' }), 'Mundo do eduardo (com bot)')
  assert.equal(motdText(null), '')
})
