// Iniciador/supervisor do bot.
// - Mostra a saída no console e grava o mesmo conteúdo em logs/bot-run.log.
// - Com --supervise (ou MBOT_SUPERVISE=1), reinicia o index.js se ele cair
//   com código diferente de 0, com backoff exponencial (10s até 60s).
// - Ctrl+C encerra o bot e o supervisor.
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = __dirname
const logDir = path.join(root, 'logs')
fs.mkdirSync(logDir, { recursive: true })
const logFile = path.join(logDir, 'bot-run.log')
const out = fs.createWriteStream(logFile, { flags: 'a', encoding: 'utf8' })

const supervise = process.argv.includes('--supervise') || process.env.MBOT_SUPERVISE === '1'
const baseDelay = Math.max(1000, Number(process.env.MBOT_RESTART_MS) || 10000)
const maxDelay = Math.max(baseDelay, Number(process.env.MBOT_RESTART_MAX_MS) || 60000)

let child = null
let stopping = false
let finished = false
let restarts = 0
let restartTimer = null
let childStartedAt = 0

function line (text) {
  const msg = String(text)
  out.write(msg + '\n')
  console.log(msg)
}

function tee (stream, dest) {
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    dest.write(chunk)
    out.write(chunk)
  })
}

function finish (code) {
  if (finished) return
  finished = true
  if (restartTimer) clearTimeout(restartTimer)
  out.write(`[supervisor] encerrado (code=${code == null ? 0 : code})\n`)
  out.end(() => {
    console.log(`\n[iniciar-bot] Bot encerrado. Log: ${logFile}`)
    process.exit(code == null ? 0 : code)
  })
}

function start () {
  if (stopping || finished) return
  childStartedAt = Date.now()
  line(`\n===== ${new Date().toISOString()} iniciando index.js${supervise ? ' (supervisionado)' : ''} =====`)
  child = spawn(process.execPath, [path.join(root, 'index.js')], {
    cwd: root,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env
  })
  tee(child.stdout, process.stdout)
  tee(child.stderr, process.stderr)

  child.on('error', (err) => line(`[supervisor] erro ao iniciar o bot: ${err.message}`))
  child.on('exit', (code, signal) => {
    const aliveSeconds = Math.round((Date.now() - childStartedAt) / 1000)
    child = null
    if (stopping) {
      finish(code)
      return
    }
    // 0 = encerramento pedido pelo próprio bot (!parar): não reinicia.
    if (!supervise || code === 0) {
      finish(code)
      return
    }
    // Se ficou bastante tempo de pé, a falha não é um loop de inicialização.
    if (aliveSeconds > 60) restarts = 0
    restarts++
    const delay = Math.min(maxDelay, baseDelay * 2 ** (restarts - 1))
    line(`[supervisor] bot caiu (code=${code} signal=${signal || '-'}) após ${aliveSeconds}s; reiniciando em ${Math.round(delay / 1000)}s (tentativa ${restarts})`)
    restartTimer = setTimeout(start, delay)
  })
}

function stop (signal) {
  if (stopping) return
  stopping = true
  if (restartTimer) clearTimeout(restartTimer)
  line(`[supervisor] encerrando (${signal})...`)
  if (child && child.exitCode === null) {
    child.kill(signal)
    setTimeout(() => {
      if (child && child.exitCode === null) child.kill('SIGKILL')
    }, 5000).unref()
  } else {
    finish(0)
  }
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))

start()
