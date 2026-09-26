// lib/lan.js
// Anuncia um servidor na lista "Jogos em LAN" do Minecraft, do mesmo jeito que o
// jogo faz ao "Abrir para LAN": multicast UDP em 224.0.2.60:4445 a cada 1,5s com
// "[MOTD]<nome>[/MOTD][AD]<porta>[/AD]". O cliente usa o IP de quem enviou.

const dgram = require('dgram')
const os = require('os')

const GROUP = '224.0.2.60'
const PORT = 4445
const INTERVAL_MS = 1500

// Texto do MOTD do ping (string, componente de chat ou NBT).
function motdText(description) {
  if (!description) return ''
  if (typeof description === 'string') return description
  const value = description.value ?? description
  if (typeof value === 'string') return value
  const text = value.text?.value ?? value.text ?? ''
  const extra = (value.extra?.value?.value ?? value.extra ?? []).map(motdText).join('')
  return (typeof text === 'string' ? text : '') + extra
}

function lanMessage(motd, port) {
  // Colchetes quebrariam o parser do cliente.
  const clean = String(motd || 'Servidor').replace(/[[\]]/g, '').slice(0, 100)
  return Buffer.from(`[MOTD]${clean}[/MOTD][AD]${port}[/AD]`, 'utf8')
}

// Endereços IPv4 das interfaces de rede (Wi-Fi, cabo), sem o loopback.
function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address)
}

// Começa a anunciar; devolve uma função que para o anúncio.
function announceLan({ motd, port, log = console.log }) {
  const message = lanMessage(motd, port)
  const sockets = lanAddresses().map((address) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    socket.on('error', (err) => log(`[lan] erro em ${address}: ${err.message}`))
    socket.bind(0, address, () => {
      socket.setMulticastInterface(address)
      socket.setMulticastTTL(1) // só a rede local
    })
    return socket
  })
  if (!sockets.length) {
    log('[lan] nenhuma interface de rede encontrada; anúncio desativado')
    return () => {}
  }
  const timer = setInterval(() => {
    for (const socket of sockets) socket.send(message, PORT, GROUP, () => {})
  }, INTERVAL_MS)
  log(`[lan] anunciando "${motd}" na porta ${port} via ${lanAddresses().join(', ')}`)
  return () => {
    clearInterval(timer)
    for (const socket of sockets) socket.close()
  }
}

module.exports = { announceLan, lanMessage, lanAddresses, motdText }
