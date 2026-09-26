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

// Endereço que o sistema usa para sair da rede (rota padrão). Com cabo e Wi-Fi
// ligados, anunciar pelos dois faria o mundo aparecer duplicado nos outros PCs.
// UDP connect só consulta a rota; nenhum pacote é enviado.
function primaryAddress() {
  const addresses = lanAddresses()
  return new Promise((resolve) => {
    const probe = dgram.createSocket('udp4')
    const done = (address) => {
      probe.close()
      resolve(addresses.includes(address) ? address : addresses[0] || null)
    }
    probe.on('error', () => done(null))
    probe.connect(53, '8.8.8.8', () => done(probe.address().address))
  })
}

// Começa a anunciar; devolve uma função que para o anúncio.
function announceLan({ motd, port, address = process.env.MINECRAFT_LAN_ADDRESS, log = console.log }) {
  const message = lanMessage(motd, port)
  let socket = null
  let timer = null
  let stopped = false

  Promise.resolve(address || primaryAddress()).then((local) => {
    if (stopped) return
    if (!local) {
      log('[lan] nenhuma interface de rede encontrada; anúncio desativado')
      return
    }
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    socket.on('error', (err) => log(`[lan] erro em ${local}: ${err.message}`))
    socket.bind(0, local, () => {
      socket.setMulticastInterface(local)
      socket.setMulticastTTL(1) // só a rede local
      timer = setInterval(() => socket.send(message, PORT, GROUP, () => {}), INTERVAL_MS)
      log(`[lan] anunciando "${motd}" em ${local}:${port}`)
    })
  })

  return () => {
    stopped = true
    clearInterval(timer)
    socket?.close()
  }
}

module.exports = { announceLan, lanMessage, lanAddresses, primaryAddress, motdText }
