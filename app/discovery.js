// @ts-check
// app/discovery.js
// Encontra o servidor Minecraft: MINECRAFT_PORT, senão portas Java locais, senão 25565.

const { execFileSync } = require('child_process')
const { ping } = require('minecraft-protocol')
const { motdText } = require('../lib/lan')

const DEFAULT_PORT = 25565

function envPort(value) {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
}

// Portas TCP abertas por processos Java nesta máquina (o mundo LAN usa uma
// porta aleatória a cada vez que é aberto).
function javaListeningPorts() {
  try {
    const out = execFileSync('ss', ['-ltnpH'], { encoding: 'utf8' })
    return out.split('\n')
      .filter((line) => line.includes('"java"'))
      .map((line) => envPort(line.split(/\s+/)[3]?.split(':').pop()))
      .filter(Boolean)
  } catch {
    return []
  }
}

function pingServer(host, port) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 3000)
    ping({ host, port }, (err, res) => {
      clearTimeout(timer)
      if (err || !res?.version) return resolve(null)
      // Servidores antigos respondem o ping legado: version é texto e o MOTD vem em `motd`.
      if (typeof res.version === 'string') return resolve({ port, version: res.version, motd: motdText('motd' in res ? res.motd : '') })
      resolve({ port, version: res.version.name, motd: motdText('description' in res ? res.description : '') })
    })
  })
}

function candidatePorts(connection, localPorts = javaListeningPorts) {
  const candidates = connection.port ? [connection.port]
    : connection.local ? [...localPorts(), DEFAULT_PORT] : [DEFAULT_PORT]
  return [...new Set(candidates)]
}

/**
 * @param {{ host?: string, port?: number | null, local?: boolean }} connection
 * @param {{ ping?: (host: string, port: number) => Promise<any>, localPorts?: () => number[] }} [options]
 */
async function findServer(connection, { ping: pingFn = pingServer, localPorts } = {}) {
  for (const port of candidatePorts(connection, localPorts)) {
    const server = await pingFn(connection.host, port)
    if (server) return server
  }
  return null
}

module.exports = { envPort, findServer, candidatePorts, DEFAULT_PORT }
