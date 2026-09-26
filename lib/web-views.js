// lib/web-views.js
// Visualizador 3D (prismarine-viewer) e inventário (mineflayer-web-inventory)
// presos a 127.0.0.1.
//
// Os adaptadores prontos fazem `http.listen(port)` sem host, ou seja, em todas
// as interfaces: com o servidor em online-mode=false qualquer PC da rede veria
// o mundo e o inventário do bot. Aqui:
// - viewer: o mesmo adaptador de prismarine-viewer/lib/mineflayer.js (1.33.0),
//   montado com o WorldView e os arquivos públicos exportados pelo pacote, mas
//   com o servidor HTTP nosso, em 127.0.0.1;
// - inventário: as opções documentadas `http` e `startOnLoad: false` deixam o
//   plugin usar um servidor HTTP que nós abrimos em 127.0.0.1.
//
// Só o bot principal tem visualizador/inventário: cada worker precisaria de
// portas próprias e de um WorldView por bot.

const http = require('http')
const path = require('path')
const { createRequire } = require('module')

const LOCALHOST = '127.0.0.1'

// Estado observável de cada visualização, lido pelo painel.
function viewState(kind, port) {
  return { kind, port, host: LOCALHOST, status: port ? 'iniciando' : 'desligado', address: null, error: null }
}

function listenLocal(server, state, log) {
  server.once('error', (err) => {
    state.status = 'erro'
    state.error = err.message
    log(`[plugins] ${state.kind} indisponível: ${err.message}`)
  })
  server.listen(state.port, LOCALHOST, () => {
    const address = server.address()
    state.status = 'ativo'
    state.address = address.address
    state.port = address.port
    log(`[plugins] ${state.kind}: http://${LOCALHOST}:${address.port}`)
  })
}

function startViewer(bot, { port, viewDistance = 6, log = console.log } = {}) {
  const state = viewState('visualizador 3D', port)
  if (!port) return state
  let pvRequire
  let pv
  try {
    pvRequire = createRequire(require.resolve('prismarine-viewer/package.json'))
    pv = pvRequire('./index.js')
  } catch (err) {
    state.status = 'erro'
    state.error = err.message.split('\n')[0]
    log(`[plugins] visualizador 3D indisponível: ${state.error}`)
    return state
  }
  if (!pv.supportedVersions.includes(bot.version)) {
    state.status = 'sem suporte'
    state.error = `suporta até ${pv.supportedVersions.at(-1)}`
    log(`[plugins] visualizador 3D não suporta ${bot.version} (${state.error})`)
    return state
  }

  const express = pvRequire('express')
  const compression = pvRequire('compression')
  const { WorldView } = pv.viewer
  const app = express()
  app.use(compression())
  app.use('/', express.static(path.join(path.dirname(require.resolve('prismarine-viewer/package.json')), 'public')))
  const server = http.createServer(app)
  const io = pvRequire('socket.io')(server, { path: '/socket.io' })
  const sockets = new Set()

  io.on('connection', (socket) => {
    if (!bot.entity) {
      socket.disconnect(true)
      return
    }
    socket.emit('version', bot.version)
    sockets.add(socket)
    const worldView = new WorldView(bot.world, viewDistance, bot.entity.position, socket)
    worldView.init(bot.entity.position)
    const botPosition = () => {
      if (!bot.entity) return
      socket.emit('position', { pos: bot.entity.position, yaw: bot.entity.yaw, addMesh: true })
      worldView.updatePosition(bot.entity.position)
    }
    bot.on('move', botPosition)
    worldView.listenToBot(bot)
    socket.on('disconnect', () => {
      bot.removeListener('move', botPosition)
      worldView.removeListenersFromBot(bot)
      sockets.delete(socket)
    })
  })

  state.close = () => {
    for (const socket of sockets) socket.disconnect(true)
    server.close()
    state.status = 'desligado'
  }
  listenLocal(server, state, log)
  return state
}

function startInventory(bot, { port, log = console.log } = {}) {
  const state = viewState('inventário web', port)
  if (!port) return state
  let plugin
  let express
  try {
    plugin = require('mineflayer-web-inventory')
    express = createRequire(require.resolve('mineflayer-web-inventory/package.json'))('express')
  } catch (err) {
    state.status = 'erro'
    state.error = err.message.split('\n')[0]
    log(`[plugins] inventário web indisponível: ${state.error}`)
    return state
  }
  const app = express()
  const server = http.createServer(app)
  try {
    // startOnLoad: false — o plugin não chama listen(port) sem host; nós abrimos o servidor.
    plugin(bot, { port, app, express, http: server, startOnLoad: false })
  } catch (err) {
    state.status = 'erro'
    state.error = err.message.split('\n')[0]
    log(`[plugins] inventário web indisponível: ${state.error}`)
    return state
  }
  // O plugin registra bot.once('end', stop) e stop() rejeita se isRunning for
  // falso — o que acontece quando o listen é nosso. A rejeição sem tratamento
  // derrubava o processo antes de o index.js salvar o estado. Com isRunning
  // verdadeiro, stop() só fecha o servidor (e resolve mesmo se já estiver fechado).
  bot.webInventory.isRunning = true
  state.close = () => {
    server.close()
    state.status = 'desligado'
  }
  listenLocal(server, state, log)
  return state
}

module.exports = { startViewer, startInventory, LOCALHOST }
