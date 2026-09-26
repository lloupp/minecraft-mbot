const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter, once } = require('node:events')
const net = require('node:net')
const { Vec3 } = require('vec3')
const { io } = require('socket.io-client')
const { startViewer } = require('../lib/web-views')

async function freePort () {
  const server = net.createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

for (const firstPerson of [true, false]) {
  test(`viewer envia posição inicial e deslocamento de 220 blocos (firstPerson=${firstPerson})`, async t => {
    const bot = Object.assign(new EventEmitter(), {
      version: '1.20.1', username: 'worker', entities: {},
      entity: { position: new Vec3(0, 64, 0), yaw: 0.3, pitch: -0.2 },
      world: { getColumnAt: async () => null }
    })
    const port = await freePort()
    // O caso true testa o padrão usado por startWebViews no runtime.
    const viewer = startViewer(bot, { port, viewDistance: 1, log: () => {}, ...(firstPerson ? {} : { firstPerson: false }) })
    t.after(() => viewer.close())
    const socket = io(`http://127.0.0.1:${port}`, { autoConnect: false, reconnection: false, transports: ['websocket'] })
    t.after(() => socket.disconnect())
    const initial = once(socket, 'position', { signal: AbortSignal.timeout(5000) })
    socket.connect()
    const [position] = await initial
    assert.deepEqual(position.pos, { x: 0, y: 64, z: 0 })
    assert.equal(position.yaw, 0.3)
    assert.equal(position.pitch, firstPerson ? -0.2 : undefined)
    assert.equal(viewer.address, '127.0.0.1')

    const moved = once(socket, 'position', { signal: AbortSignal.timeout(5000) })
    bot.entity.position = new Vec3(220, 70, -8)
    bot.entity.yaw = 1.2
    bot.entity.pitch = 0.4
    bot.emit('move')
    const [next] = await moved
    assert.deepEqual(next.pos, { x: 220, y: 70, z: -8 })
    assert.equal(next.yaw, 1.2)
    assert.equal(next.pitch, firstPerson ? 0.4 : undefined)
  })
}
