'use strict'

const { loadEnvFile } = require('node:process')

// The shell keeps precedence. A missing local file is normal (services and
// test harnesses pass their environment directly); other I/O errors are not.
function loadLocalEnv(file = '.env') {
  try { loadEnvFile(file) } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function connectionSettings(env = process.env) {
  const rawPort = env.MINECRAFT_PORT
  let port = null
  if (rawPort !== undefined) {
    if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
      throw new Error('MINECRAFT_PORT deve ser um número inteiro entre 1 e 65535.')
    }
    port = Number(rawPort)
  }
  const host = (env.MINECRAFT_HOST || '127.0.0.1').trim()
  if (!host) throw new Error('MINECRAFT_HOST não pode estar vazio.')
  return {
    host, port,
    owner: env.MINECRAFT_OWNER || null,
    username: env.MINECRAFT_BOT_NAME || 'eduardo_bot',
    local: ['127.0.0.1', 'localhost', '::1'].includes(host)
  }
}

module.exports = { loadLocalEnv, connectionSettings }
