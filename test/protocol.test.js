const test = require('node:test')
const assert = require('node:assert/strict')

const { fixOutgoingPackets } = require('../lib/protocol')

function fakeClient(protocolVersion = 777) {
  const sent = []
  return { protocolVersion, sent, write: (name, params) => sent.push({ name, params }) }
}

test('insere tick_end entre dois pacotes de posição no mesmo tick', () => {
  const client = fakeClient()
  fixOutgoingPackets(client)
  client.write('position_look', { x: 1 })
  client.write('position', { x: 2 })
  client.write('tick_end', {})
  client.write('position', { x: 3 })
  assert.deepEqual(client.sent.map((p) => p.name), ['position_look', 'tick_end', 'position', 'tick_end', 'position'])
})

test('remapeia status de block_dig para o enum do 26.3', () => {
  const client = fakeClient()
  fixOutgoingPackets(client)
  client.write('block_dig', { status: 0, location: {}, face: 1 })
  client.write('block_dig', { status: 2, location: {}, face: 1 })
  client.write('block_dig', { status: 1, location: {}, face: 1 })
  assert.deepEqual(client.sent.map((p) => p.params.status), [0, 3, 2])
})

test('agrupa block_place em hitResult', () => {
  const client = fakeClient()
  fixOutgoingPackets(client)
  const location = { x: 1, y: 2, z: 3 }
  client.write('block_place', { location, direction: 1, hand: 0, cursorX: 0.5, cursorY: 1, cursorZ: 0.5, sequence: 0 })
  assert.deepEqual(client.sent[0].params, {
    hand: 0,
    sequence: 0,
    hitResult: { location, direction: 1, cursorX: 0.5, cursorY: 1, cursorZ: 0.5, insideBlock: false, worldBorderHit: false }
  })
})

test('não altera pacotes em versões anteriores ao 26.3', () => {
  const client = fakeClient(767)
  fixOutgoingPackets(client)
  client.write('block_dig', { status: 2 })
  client.write('position', {})
  client.write('position', {})
  assert.deepEqual(client.sent.map((p) => [p.name, p.params.status]), [['block_dig', 2], ['position', undefined], ['position', undefined]])
})
