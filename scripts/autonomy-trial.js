'use strict'

// Sessão autônoma real: mundo novo, ninguém online, o perfil de
// examples/minecraft-mbot-autonomous.env e ciclo dia/noite natural. Nada é dado
// ao bot e nenhum comando de chat é enviado. A cada amostra, o console do
// servidor diz posição, vida, fome e inventário; o log do bot diz as metas.
//
// MBOT_TEST_SERVER_JAR=.cache/vanilla-1.20.1.jar MBOT_TEST_EULA_ACCEPTED=1 \
//   MBOT_AUTONOMY_MINUTES=30 MBOT_AUTONOMY_OUTPUT_DIR=autonomy node scripts/autonomy-trial.js

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..')
const JAR = process.env.MBOT_TEST_SERVER_JAR
const OUT = path.resolve(process.env.MBOT_AUTONOMY_OUTPUT_DIR || 'autonomy-evidence')
const SEED = process.env.MBOT_AUTONOMY_SEED || 'mbot-campo-1'
const MINUTES = Number(process.env.MBOT_AUTONOMY_MINUTES || 30)
const PORT = Number(process.env.MBOT_AUTONOMY_PORT || 25612)
const SAMPLE_MS = 30000
const BOT = 'eduardo_bot'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (!JAR || process.env.MBOT_TEST_EULA_ACCEPTED !== '1') {
  console.error('Defina MBOT_TEST_SERVER_JAR e MBOT_TEST_EULA_ACCEPTED=1 (aceite da EULA do Minecraft).')
  process.exit(2)
}

// Marcos de progresso, na ordem em que um jogador costuma alcançá-los.
const MILESTONES = [
  ['madeira', /_log$/], ['tábuas', /_planks$/], ['mesa', /^crafting_table$/], ['picareta de madeira', /^wooden_pickaxe$/],
  ['pedregulho', /^cobblestone$|^cobbled_deepslate$/], ['picareta de pedra', /^stone_pickaxe$/], ['espada de pedra', /^stone_sword$/],
  ['carvão', /^coal$/], ['comida', /^(beef|porkchop|mutton|chicken|rabbit|cod|salmon|bread|apple|carrot|potato|cooked_.+|sweet_berries)$/],
  ['comida cozida', /^cooked_/], ['minério de ferro', /^raw_iron$|iron_ore$/], ['lingote de ferro', /^iron_ingot$/],
  ['picareta de ferro', /^iron_pickaxe$/], ['espada de ferro', /^iron_sword$/], ['armadura de ferro', /^iron_(helmet|chestplate|leggings|boots)$/]
]

function waitFor(check, timeoutMs, intervalMs = 500) {
  return (async () => {
    const end = Date.now() + timeoutMs
    for (;;) {
      const value = await check()
      if (value) return value
      if (Date.now() > end) return null
      await sleep(intervalMs)
    }
  })()
}

function topLevelEntries(snbt) {
  const entries = []
  let depth = 0
  let start = -1
  for (let i = 0; i < snbt.length; i++) {
    if (snbt[i] === '{' && depth++ === 0) start = i
    else if (snbt[i] === '}' && --depth === 0) entries.push(snbt.slice(start, i + 1))
  }
  return entries
}

function parseItems(snbt) {
  const items = {}
  for (const entry of topLevelEntries(snbt)) {
    const top = entry.replace(/tag: \{.*\}/, '')
    const id = top.match(/id: "minecraft:([a-z0-9_]+)"/)?.[1]
    const count = Number(top.match(/Count: (\d+)b/)?.[1] || 0)
    if (id) items[id] = (items[id] || 0) + count
  }
  return items
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true })
  const serverDir = path.join(OUT, 'server')
  const dataDir = path.join(OUT, 'bot-data')
  fs.mkdirSync(serverDir, { recursive: true })
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(serverDir, 'eula.txt'), 'eula=true\n')
  fs.writeFileSync(path.join(serverDir, 'server.properties'), [
    'online-mode=false', `server-port=${PORT}`, 'server-ip=127.0.0.1', `level-seed=${SEED}`, 'difficulty=easy',
    'gamemode=survival', 'spawn-protection=0', 'view-distance=6', 'simulation-distance=6', 'enable-status=true'
  ].join('\n') + '\n')

  const server = spawn('java', ['-Xmx2G', '-jar', path.resolve(JAR), 'nogui'], { cwd: serverDir, stdio: ['pipe', 'pipe', 'pipe'] })
  let serverLog = ''
  const onServer = (d) => { serverLog += d; fs.appendFileSync(path.join(OUT, 'server.log'), d) }
  server.stdout.on('data', onServer)
  server.stderr.on('data', onServer)
  let chain = Promise.resolve()
  const query = (command, pattern, timeoutMs = 5000) => {
    const run = async () => {
      const offset = serverLog.length
      server.stdin.write(command + '\n')
      return waitFor(() => serverLog.slice(offset).match(pattern), timeoutMs, 100)
    }
    const result = chain.then(run, run)
    chain = result.catch(() => {})
    return result
  }
  const data = async (path, pattern) => (await query(`data get entity ${BOT} ${path}`, new RegExp(`${BOT} has the following entity data: ${pattern}|No entity was found`)))

  const report = { seed: SEED, minutes: MINUTES, profile: 'examples/minecraft-mbot-autonomous.env', samples: [], milestones: {}, deaths: [], kicks: [], goals: [] }
  let bot = null
  let botLog = ''
  try {
    await waitFor(() => serverLog.includes('Done ('), 180000)
    // Perfil autônomo do repositório, só trocando host/porta e os arquivos de estado.
    const profile = Object.fromEntries(fs.readFileSync(path.join(REPO, 'examples/minecraft-mbot-autonomous.env'), 'utf8')
      .split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split(/=(.*)/s).slice(0, 2)))
    bot = spawn(process.execPath, [path.join(REPO, 'index.js')], {
      cwd: REPO,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env, ...profile, MINECRAFT_HOST: '127.0.0.1', MINECRAFT_PORT: String(PORT), MINECRAFT_OWNER: '',
        COLONY_STATE_FILE: path.join(dataDir, 'state.json'), MEMORY_FILE: path.join(dataDir, 'memory.json'),
        COLONY_EVENT_LOG: path.join(dataDir, 'events.jsonl'), MBOT_VIEWER_PORT: '0', MBOT_INVENTORY_PORT: '0'
      }
    })
    const onBot = (d) => { botLog += d; fs.appendFileSync(path.join(OUT, 'bot.log'), d) }
    bot.stdout.on('data', onBot)
    bot.stderr.on('data', onBot)
    const joined = await waitFor(() => serverLog.includes(`${BOT} joined the game`), 60000)
    if (!joined) throw new Error('bot não entrou: ' + botLog.split('\n').slice(-5).join(' | '))

    const start = Date.now()
    let last = null
    while (Date.now() - start < MINUTES * 60000) {
      await sleep(SAMPLE_MS)
      if (bot.exitCode != null) { report.botExited = bot.exitCode; break }
      const p = await data('Pos', '\\[(-?[\\d.E-]+)d, (-?[\\d.E-]+)d, (-?[\\d.E-]+)d\\]')
      const h = await data('Health', '([\\d.]+)f')
      const f = await data('foodLevel', '(\\d+)')
      const inv = await data('Inventory', '(\\[.*\\])')
      const time = await query('time query daytime', /The time is (\d+)/)
      const items = inv?.[1] ? parseItems(inv[1]) : {}
      const sample = {
        minute: Number(((Date.now() - start) / 60000).toFixed(1)),
        pos: p?.[1] ? { x: Math.round(Number(p[1])), y: Math.round(Number(p[2])), z: Math.round(Number(p[3])) } : null,
        health: h?.[1] ? Number(h[1]) : null,
        food: f?.[1] ? Number(f[1]) : null,
        night: time ? Number(time[1]) % 24000 >= 13000 : null,
        items
      }
      sample.movedBlocks = last?.pos && sample.pos ? Math.round(Math.hypot(sample.pos.x - last.pos.x, sample.pos.z - last.pos.z)) : null
      report.samples.push(sample)
      for (const [label, pattern] of MILESTONES) {
        if (!report.milestones[label] && Object.keys(items).some((k) => pattern.test(k))) report.milestones[label] = sample.minute
      }
      last = sample
      console.log(`${sample.minute} min ${sample.night ? 'noite' : 'dia'} hp=${sample.health} fome=${sample.food} pos=${JSON.stringify(sample.pos)} moveu=${sample.movedBlocks} itens=${JSON.stringify(items)}`)
      fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
    }
  } catch (error) {
    report.fatal = error.message
    console.error(error)
  } finally {
    bot?.kill('SIGTERM')
    await sleep(3000)
    server.stdin.write('stop\n')
    await Promise.race([new Promise((resolve) => server.on('exit', resolve)), sleep(30000)])
    if (server.exitCode == null) server.kill('SIGKILL')

    const DEATH = /\]: (eduardo_bot) (was slain|was shot|drowned|died|fell|burned|blew up|suffocated|starved|tried to swim|hit the ground|went up in flames|was blown up|was killed|froze|was squashed|walked into)[^\n]*/g
    report.deaths = [...serverLog.matchAll(DEATH)].map((m) => m[0].slice(3).trim())
    report.kicks = [...serverLog.matchAll(/\]: eduardo_bot lost connection: ([^\n]*)/g)].map((m) => m[1]).filter((r) => !/quitting/i.test(r))
    report.goals = botLog.split('\n').filter((l) => l.startsWith('[autônomo]')).slice(0, 400)
    const goalCounts = {}
    for (const line of report.goals) {
      const meta = line.match(/^\[autônomo\] meta: (.+)$/)?.[1]
      if (meta) goalCounts[meta] = (goalCounts[meta] || 0) + 1
    }
    report.goalAttempts = goalCounts
    report.failures = botLog.split('\n').filter((l) => /^Não consegui|Não consegui /.test(l) || /\[autônomo\].*(falh|não)/i.test(l)).slice(0, 50)
    // Maior intervalo sem sair de um raio de 3 blocos.
    let anchor = null
    let longest = 0
    for (const s of report.samples) {
      if (!s.pos) continue
      if (!anchor || Math.hypot(s.pos.x - anchor.pos.x, s.pos.z - anchor.pos.z) > 3) { anchor = s; continue }
      longest = Math.max(longest, s.minute - anchor.minute)
    }
    report.longestIdleMinutes = Number(longest.toFixed(1))
    report.minHealth = Math.min(...report.samples.map((s) => s.health ?? 20))
    report.minFood = Math.min(...report.samples.map((s) => s.food ?? 20))
    report.finalItems = report.samples.at(-1)?.items || {}
    report.botErrors = botLog.split('\n').filter((l) => /TypeError|ReferenceError|is not a function|Unhandled/i.test(l)).slice(0, 10)
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
    console.log('\nRESUMO ' + JSON.stringify({
      minutes: report.samples.at(-1)?.minute, deaths: report.deaths, kicks: report.kicks, milestones: report.milestones,
      goalAttempts: report.goalAttempts, longestIdleMinutes: report.longestIdleMinutes, minHealth: report.minHealth,
      minFood: report.minFood, finalItems: report.finalItems, botErrors: report.botErrors, fatal: report.fatal
    }, null, 2))
    process.exit(0)
  }
}

main()
