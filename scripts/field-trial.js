'use strict'

// Teste de campo: o bot como um jogador o usaria, num servidor vanilla 1.20.1
// real com terreno normal, survival e monstros. Um "dono" (criativo, para não
// interferir) dá ordens pelo chat; cada resultado é medido pelo console do
// servidor (posição, vida, fome, inventário, baú, mortes), não pelo que o bot diz.
//
// MBOT_TEST_SERVER_JAR=.cache/vanilla-1.20.1.jar MBOT_TEST_EULA_ACCEPTED=1 \
//   MBOT_FIELD_OUTPUT_DIR=field node scripts/field-trial.js
//
// Saída: <dir>/report.json, <dir>/report.md, logs do servidor e do bot.

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const mineflayer = require('mineflayer')

const REPO = path.resolve(__dirname, '..')
const JAR = process.env.MBOT_TEST_SERVER_JAR
const OUT = path.resolve(process.env.MBOT_FIELD_OUTPUT_DIR || 'field-evidence')
const SEED = process.env.MBOT_FIELD_SEED || 'mbot-campo-1'
const PORT = Number(process.env.MBOT_FIELD_PORT || 25611)
const BOT = 'eduardo_bot'
const OWNER = 'dono'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (!JAR || process.env.MBOT_TEST_EULA_ACCEPTED !== '1') {
  console.error('Defina MBOT_TEST_SERVER_JAR e MBOT_TEST_EULA_ACCEPTED=1 (aceite da EULA do Minecraft).')
  process.exit(2)
}

async function waitFor(check, timeoutMs, intervalMs = 1000) {
  const end = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > end) return null
    await sleep(intervalMs)
  }
}

// ---------- servidor ----------
function startServer() {
  const dir = path.join(OUT, 'server')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n')
  fs.writeFileSync(path.join(dir, 'server.properties'), [
    'online-mode=false', `server-port=${PORT}`, 'server-ip=127.0.0.1', `level-seed=${SEED}`,
    'difficulty=easy', 'gamemode=survival', 'spawn-protection=0', 'view-distance=6',
    'simulation-distance=6', 'max-players=10', 'enable-status=true', 'spawn-monsters=true', 'spawn-animals=true'
  ].join('\n') + '\n')
  const proc = spawn('java', ['-Xmx2G', '-jar', path.resolve(JAR), 'nogui'], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] })
  let log = ''
  const logFile = path.join(OUT, 'server.log')
  const onData = (d) => { log += d; fs.appendFileSync(logFile, d) }
  proc.stdout.on('data', onData)
  proc.stderr.on('data', onData)
  let chain = Promise.resolve()
  // Comandos em série: cada um espera a própria linha de resposta.
  function query(command, pattern, timeoutMs = 5000) {
    const run = async () => {
      const offset = log.length
      proc.stdin.write(command + '\n')
      return waitFor(() => {
        const match = log.slice(offset).match(pattern)
        return match || null
      }, timeoutMs, 100)
    }
    const result = chain.then(run, run)
    chain = result.catch(() => {})
    return result
  }
  return { proc, get log() { return log }, query, cmd: (c) => query(c, /\n/, 3000) }
}

// ---------- bot sob teste ----------
function startBot(dataDir) {
  const proc = spawn(process.execPath, [path.join(REPO, 'index.js')], {
    cwd: REPO,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MINECRAFT_HOST: '127.0.0.1', MINECRAFT_PORT: String(PORT), MINECRAFT_VERSION: '1.20.1',
      MINECRAFT_OWNER: OWNER, MINECRAFT_BOT_NAME: BOT, MINECRAFT_PROFILE: 'vanilla1201',
      COLONY_STATE_FILE: path.join(dataDir, 'state.json'), MEMORY_FILE: path.join(dataDir, 'memory.json'),
      COLONY_EVENT_LOG: path.join(dataDir, 'events.jsonl'), MBOT_TOOL_API: '0', STATUS_SERVER: '0',
      MBOT_DASHBOARD: '0', MINECRAFT_LAN_ANNOUNCE: '0', MBOT_VIEWER_PORT: '0', MBOT_INVENTORY_PORT: '0'
    }
  })
  let log = ''
  const logFile = path.join(OUT, 'bot.log')
  const onData = (d) => { log += d; fs.appendFileSync(logFile, d) }
  proc.stdout.on('data', onData)
  proc.stderr.on('data', onData)
  const exited = new Promise((resolve) => proc.on('exit', (code) => resolve(code)))
  return { proc, exited, get log() { return log } }
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })
  const dataDir = path.join(OUT, 'bot-data')
  fs.mkdirSync(dataDir)
  const report = { seed: SEED, startedAt: new Date().toISOString(), scenarios: [], deaths: [], kicks: [], botErrors: [] }
  const server = startServer()
  let bot = null
  let owner = null
  const heard = []

  // ---------- leituras pelo console ----------
  const num = (s) => Number(s)
  async function pos(name) {
    const m = await server.query(`data get entity ${name} Pos`, new RegExp(`${name} has the following entity data: \\[(-?[\\d.E-]+)d, (-?[\\d.E-]+)d, (-?[\\d.E-]+)d\\]|No entity was found`))
    return m && m[1] ? { x: num(m[1]), y: num(m[2]), z: num(m[3]) } : null
  }
  async function health(name) {
    const m = await server.query(`data get entity ${name} Health`, new RegExp(`${name} has the following entity data: ([\\d.]+)f|No entity was found`))
    return m && m[1] ? num(m[1]) : null
  }
  async function foodLevel(name) {
    const m = await server.query(`data get entity ${name} foodLevel`, new RegExp(`${name} has the following entity data: (\\d+)|No entity was found`))
    return m && m[1] ? num(m[1]) : null
  }
  // Entradas de topo da lista SNBT; itens com `tag: {...}` têm chaves aninhadas.
  const topLevelEntries = (snbt) => {
    const entries = []
    let depth = 0
    let start = -1
    for (let i = 0; i < snbt.length; i++) {
      if (snbt[i] === '{' && depth++ === 0) start = i
      else if (snbt[i] === '}' && --depth === 0) entries.push(snbt.slice(start, i + 1))
    }
    return entries
  }
  const parseItems = (snbt) => {
    const items = {}
    for (const entry of topLevelEntries(snbt)) {
      const top = entry.replace(/tag: \{.*\}/, '')
      const id = top.match(/id: "minecraft:([a-z0-9_]+)"/)?.[1]
      const count = Number(top.match(/Count: (\d+)b/)?.[1] || 0)
      if (id) items[id] = (items[id] || 0) + count
    }
    return items
  }
  async function inventory(name) {
    const m = await server.query(`data get entity ${name} Inventory`, new RegExp(`${name} has the following entity data: (\\[.*\\])|No entity was found`))
    return m && m[1] ? parseItems(m[1]) : {}
  }
  async function chestItems({ x, y, z }) {
    const m = await server.query(`data get block ${x} ${y} ${z} Items`, /block data: (\[.*\])|is not a block entity|not loaded/)
    return m && m[1] ? parseItems(m[1]) : {}
  }
  async function nearCount(name, type, radius) {
    const m = await server.query(`execute at ${name} if entity @e[type=${type},distance=..${radius}]`, /Test passed, count: (\d+)|Test failed/)
    return m && m[1] ? num(m[1]) : 0
  }
  const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : Infinity)
  const sum = (items, pattern) => Object.entries(items).filter(([k]) => pattern.test(k)).reduce((n, [, v]) => n + v, 0)

  // Leva o dono para perto de (x, z) na superfície e confirma que ele se mexeu.
  async function moveOwner(x, z) {
    const before = await pos(OWNER)
    for (const range of [4, 8, 16]) {
      const m = await server.query(`spreadplayers ${Math.round(x)} ${Math.round(z)} 0 ${range} false ${OWNER}`, /Spread 1 player|Could not spread/)
      if (m && /Spread 1 player/.test(m[0])) {
        await waitFor(async () => dist(await pos(OWNER), before) > 5, 5000, 500)
        return await pos(OWNER)
      }
    }
    throw new Error(`não consegui levar o dono para ${Math.round(x)}, ${Math.round(z)}`)
  }
  function say(text) { owner.chat(text) }
  async function sayAndWait(text, pattern, timeoutMs = 15000) {
    const start = heard.length
    say(text)
    const reply = await waitFor(() => heard.slice(start).find((m) => pattern.test(m)) || null, timeoutMs, 200)
    return { reply, all: heard.slice(start) }
  }
  async function scenario(name, fn) {
    const started = Date.now()
    const deathsBefore = report.deaths.length
    console.log(`\n=== ${name}`)
    let result
    try {
      result = await fn()
    } catch (error) {
      result = { ok: false, error: error.message }
    }
    result.seconds = Math.round((Date.now() - started) / 1000)
    result.deathsDuring = report.deaths.slice(deathsBefore)
    report.scenarios.push({ name, ...result })
    console.log(`${result.ok ? 'OK ' : 'FALHOU'} ${name}: ${JSON.stringify(result)}`)
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
    return result
  }
  // Mortes e expulsões, lidas do log do servidor.
  const DEATH = /\]: (\w+) (was slain|was shot|drowned|died|fell|burned|blew up|suffocated|starved|tried to swim|hit the ground|went up in flames|was blown up|was killed|froze|was squashed|was pricked|walked into)[^\n]*/g
  const seenDeath = new Set()
  setInterval(() => {
    for (const m of server.log.matchAll(DEATH)) {
      if (seenDeath.has(m.index)) continue
      seenDeath.add(m.index)
      if (m[1] !== OWNER) report.deaths.push({ who: m[1], how: m[0].slice(3).trim(), at: new Date().toISOString() })
    }
    for (const m of server.log.matchAll(/\]: (\w+) lost connection: ([^\n]*)/g)) {
      const key = `k${m.index}`
      if (seenDeath.has(key)) continue
      seenDeath.add(key)
      if (m[1] !== OWNER && !/Disconnected|quitting/i.test(m[2])) report.kicks.push({ who: m[1], reason: m[2] })
    }
  }, 1000).unref()

  try {
    await waitFor(() => server.log.includes('Done ('), 180000, 500)
    if (!server.log.includes('Done (')) throw new Error('servidor não subiu')
    await server.cmd('gamerule sendCommandFeedback true')

    // ---------- 1. dono e bot entram ----------
    owner = mineflayer.createBot({ host: '127.0.0.1', port: PORT, username: OWNER, version: '1.20.1' })
    await new Promise((resolve, reject) => { owner.once('spawn', resolve); owner.once('error', reject) })
    owner.on('chat', (username, message) => { if (username === BOT) heard.push(message) })
    await server.cmd(`gamemode creative ${OWNER}`)

    await scenario('1. conectar', async () => {
      const t0 = Date.now()
      bot = startBot(dataDir)
      const joined = await waitFor(() => server.log.includes(`${BOT} joined the game`) && bot.log.includes('Bot conectado'), 60000, 500)
      if (!joined) throw new Error(`bot não entrou (exit ${bot.proc.exitCode}): ${bot.log.split('\n').filter(Boolean).slice(-4).join(' | ')}`)
      await sleep(3000)
      await server.cmd(`execute at ${BOT} run tp ${OWNER} ~2 ~ ~`)
      await sleep(2000)
      return { ok: Boolean(joined), connectSeconds: Math.round((Date.now() - t0) / 1000), spawn: await pos(BOT), health: await health(BOT) }
    })

    await scenario('2. !ajuda sem ser expulso', async () => {
      const start = heard.length
      say('!ajuda')
      await sleep(12000)
      const lines = heard.slice(start)
      const online = (await health(BOT)) != null
      return { ok: lines.length >= 4 && online && !report.kicks.some((k) => k.who === BOT), linesReceived: lines.length, stillOnline: online }
    })

    await scenario('3. seguir o dono (3 deslocamentos de ~30 blocos)', async () => {
      await sayAndWait('!seguir', /Seguindo|Não estou te vendo/)
      const trials = []
      for (const [dx, dz] of [[30, 0], [0, 30], [-25, -25]]) {
        const b = await pos(BOT)
        const target = await moveOwner(b.x + dx, b.z + dz)
        const t0 = Date.now()
        const reached = await waitFor(async () => dist(await pos(BOT), await pos(OWNER)) <= 5, 90000, 1500)
        trials.push({ ownerMovedBlocks: Math.round(dist(b, target)), reached: Boolean(reached), seconds: Math.round((Date.now() - t0) / 1000), finalDistance: Math.round(dist(await pos(BOT), await pos(OWNER))) })
      }
      return { ok: trials.every((t) => t.reached), trials }
    })

    let logName = null
    await scenario('4. minerar madeira (!minerar <tronco> 4)', async () => {
      await server.cmd(`execute at ${BOT} run tp ${OWNER} ~1 ~ ~`)
      await sleep(3000)
      const ids = Object.values(owner.registry.blocksByName).filter((b) => /_log$/.test(b.name) && !/stripped/.test(b.name)).map((b) => b.id)
      const found = owner.findBlocks({ matching: ids, maxDistance: 48, count: 300 })
      const byName = {}
      for (const p of found) { const n = owner.blockAt(p)?.name; if (n) byName[n] = (byName[n] || 0) + 1 }
      logName = Object.entries(byName).sort((a, b) => b[1] - a[1])[0]?.[0] || null
      if (!logName) return { ok: false, error: 'nenhuma árvore a 48 blocos', logsNearby: byName }
      const before = await inventory(BOT)
      const { reply } = await sayAndWait(`!minerar ${logName} 4`, /Minerei|Só consegui|Não consegui/, 180000)
      const after = await inventory(BOT)
      const gained = (after[logName] || 0) - (before[logName] || 0)
      return { ok: gained >= 4, logType: logName, logsNearby: byName, gained, reply }
    })

    await scenario('5. fabricar mesa e picareta de madeira', async () => {
      const table = await sayAndWait('!fabricar crafting_table 1', /Pronto!|Não consegui|Não conheço/, 180000)
      const pick = await sayAndWait('!fabricar wooden_pickaxe 1', /Pronto!|Não consegui|Não conheço/, 180000)
      const inv = await inventory(BOT)
      return { ok: (inv.wooden_pickaxe || 0) >= 1, replies: [table.reply, pick.reply], crafting_table: inv.crafting_table || 0, wooden_pickaxe: inv.wooden_pickaxe || 0 }
    })

    await scenario('6. comer quando tem fome', async () => {
      await server.cmd(`give ${BOT} bread 4`)
      await server.cmd(`effect give ${BOT} minecraft:hunger 20 120 true`)
      const hungry = await waitFor(async () => { const f = await foodLevel(BOT); return f != null && f <= 12 ? f : null }, 40000, 1500)
      await server.cmd(`effect clear ${BOT} minecraft:hunger`)
      const lowest = hungry ?? await foodLevel(BOT)
      const ate = await waitFor(async () => ((await inventory(BOT)).bread || 0) < 4, 40000, 1500)
      return { ok: Boolean(ate), foodWhenHungry: lowest, foodAfter: await foodLevel(BOT), breadLeft: (await inventory(BOT)).bread || 0 }
    })

    await scenario('7. combate: zumbi a 5 blocos', async () => {
      const hpBefore = await health(BOT)
      await server.cmd(`execute at ${BOT} run summon zombie ~5 ~ ~`)
      const t0 = Date.now()
      const killed = await waitFor(async () => (await nearCount(BOT, 'zombie', 24)) === 0, 90000, 1500)
      const result = { ok: Boolean(killed) && (await health(BOT)) > 0, killedSeconds: killed ? Math.round((Date.now() - t0) / 1000) : null, healthBefore: hpBefore, healthAfter: await health(BOT) }
      await server.cmd('kill @e[type=zombie]')
      return result
    })

    await scenario('8. creeper perto: fugir sem morrer', async () => {
      const hpBefore = await health(BOT)
      const start = await pos(BOT)
      await server.cmd(`execute at ${BOT} run summon creeper ~4 ~ ~`)
      await sleep(8000)
      const creeper = await nearCount(BOT, 'creeper', 6)
      await sleep(12000)
      const hpAfter = await health(BOT)
      await server.cmd('kill @e[type=creeper]')
      return { ok: hpAfter != null && hpAfter > 0, creeperWithin6After8s: creeper, movedBlocks: Math.round(dist(start, await pos(BOT))), healthBefore: hpBefore, healthAfter: hpAfter }
    })

    await scenario('9. viajar a um local salvo (!local salvar / !ir)', async () => {
      await server.cmd(`execute at ${BOT} run tp ${OWNER} ~1 ~ ~`)
      await sleep(2000)
      const saved = await sayAndWait('!local salvar marco', /Local marco salvo|Não consegui/)
      const marco = await pos(OWNER)
      const b = await pos(BOT)
      await moveOwner(b.x + 40, b.z)
      await waitFor(async () => dist(await pos(BOT), await pos(OWNER)) <= 6, 60000, 1500)
      const go = await sayAndWait('!ir marco', /Indo para marco|Não consigo|Não conheço/)
      const t0 = Date.now()
      const arrived = await waitFor(async () => dist(await pos(BOT), marco) <= 3, 120000, 1500)
      const result = { ok: Boolean(arrived), seconds: Math.round((Date.now() - t0) / 1000), finalDistance: Math.round(dist(await pos(BOT), marco)), replies: [saved.reply, go.reply] }
      await sayAndWait('!seguir', /Seguindo|Não estou/)
      return result
    })

    let chest = null
    await scenario('10. colônia numa floresta: base, estoque, 2 lenhadores no automático (4 min)', async () => {
      // Perto do spawn pode não haver árvores suficientes; a colônia é montada na floresta mais próxima.
      const located = await server.query(`execute at ${BOT} run locate biome minecraft:forest`, /nearest minecraft:forest is at \[(-?\d+), [^,]+, (-?\d+)\] \((\d+) blocks away\)|Could not find/, 60000)
      let forest = null
      if (located?.[1]) {
        forest = { x: Number(located[1]), z: Number(located[2]), distance: Number(located[3]) }
        await moveOwner(forest.x, forest.z)
        await server.cmd(`tp ${BOT} ${OWNER}`)
        await sleep(8000)
      }
      await server.cmd(`execute at ${BOT} run tp ${OWNER} ~1 ~ ~`)
      await sleep(3000)
      const o = await pos(OWNER)
      chest = { x: Math.floor(o.x) + 2, y: Math.floor(o.y), z: Math.floor(o.z) }
      await server.cmd(`setblock ${chest.x} ${chest.y} ${chest.z} chest`)
      const base = await sayAndWait('!base aqui', /agora é a base/)
      await sleep(2000)
      const stock = await sayAndWait('!estoque aqui', /Estoque central definido|Não consegui/, 30000)
      const created = await sayAndWait('!bot criar lenhador 2', /Criados|Não consegui/, 30000)
      await waitFor(() => server.log.includes('lenhador_02 joined the game'), 30000, 500)
      await sleep(5000)
      const auto = await sayAndWait('!colonia auto', /ATIVADO|Não posso/, 15000)
      const samples = []
      for (let i = 0; i < 8; i++) {
        await sleep(30000)
        const items = await chestItems(chest)
        samples.push({ t: (i + 1) * 30, logs: sum(items, /_log$/), planks: sum(items, /_planks$/), total: Object.values(items).reduce((a, b) => a + b, 0) })
        console.log(`  colônia ${samples.at(-1).t}s: baú ${JSON.stringify(items)}`)
      }
      const tasks = await sayAndWait('!tarefas', /lenhador|Nenhum/)
      const workersHealth = { lenhador_01: await health('lenhador_01'), lenhador_02: await health('lenhador_02') }
      const final = await chestItems(chest)
      return {
        ok: sum(final, /_log$|_planks$/) >= 16,
        forest,
        replies: [base.reply, stock.reply, created.reply, auto.reply, tasks.reply],
        chestFinal: final, samples, workersHealth
      }
    })

    await scenario('11. noite com monstros (2,5 min)', async () => {
      await server.cmd('time set 13000')
      const before = report.deaths.length
      const lows = {}
      for (let i = 0; i < 10; i++) {
        await sleep(15000)
        for (const name of [BOT, 'lenhador_01', 'lenhador_02']) {
          const hp = await health(name)
          if (hp != null) lows[name] = Math.min(lows[name] ?? 20, hp)
        }
      }
      const hostiles = await nearCount(BOT, 'zombie', 48) + await nearCount(BOT, 'skeleton', 48) + await nearCount(BOT, 'spider', 48) + await nearCount(BOT, 'creeper', 48)
      await server.cmd('time set 1000')
      const deaths = report.deaths.slice(before)
      return { ok: deaths.length === 0, deaths, lowestHealth: lows, hostilesWithin48AtEnd: hostiles }
    })

    await scenario('12. !parar e reinício restauram a colônia', async () => {
      say('!parar')
      const code = await Promise.race([bot.exited, sleep(20000).then(() => 'timeout')])
      await sleep(5000)
      const logBefore = bot.log.length
      bot = startBot(dataDir)
      const restored = await waitFor(() => /workers restaurados: .*lenhador/.test(bot.log) && /base restaurada/.test(bot.log), 90000, 1000)
      await waitFor(() => (server.log.match(/lenhador_01 joined the game/g) || []).length >= 2, 60000, 1000)
      await sleep(4000)
      const bots = await sayAndWait('!bots', /Colônia:/)
      return { ok: code === 0 && Boolean(restored) && /lenhadorx2/.test(bots.reply || ''), exitCode: code, restoredLine: (bot.log.match(/workers restaurados: [^\n]*/) || [null])[0], reply: bots.reply, ignoredLogBytes: logBefore }
    })
  } catch (error) {
    report.fatal = error.stack
    console.error(error)
  } finally {
    try { owner?.chat('!parar') } catch { /* dono pode já ter caído */ }
    await sleep(3000)
    bot?.proc.kill('SIGTERM')
    owner?.quit()
    server.proc.stdin.write('stop\n')
    await Promise.race([new Promise((resolve) => server.proc.on('exit', resolve)), sleep(30000)])
    if (server.proc.exitCode == null) server.proc.kill('SIGKILL')
    report.finishedAt = new Date().toISOString()
    report.botErrors = (fs.existsSync(path.join(OUT, 'bot.log')) ? fs.readFileSync(path.join(OUT, 'bot.log'), 'utf8') : '')
      .split('\n').filter((l) => /TypeError|ReferenceError|is not a function|Unhandled|uncaught/i.test(l)).slice(0, 20)
    report.passed = report.scenarios.filter((s) => s.ok).length
    report.total = report.scenarios.length
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
    const md = [
      `# Teste de campo — Minecraft 1.20.1 (seed ${SEED})`, '',
      `${report.passed}/${report.total} cenários OK · mortes: ${report.deaths.length} · expulsões: ${report.kicks.length}`, '',
      '| Cenário | Resultado | Tempo | Detalhe |', '|---|---|---|---|',
      ...report.scenarios.map((s) => {
        const { name, ok, seconds, deathsDuring, ...rest } = s
        return `| ${name} | ${ok ? '✅' : '❌'} | ${seconds}s | ${JSON.stringify(rest).replace(/\|/g, '/').slice(0, 400)} |`
      }),
      '', '## Mortes', ...(report.deaths.length ? report.deaths.map((d) => `- ${d.how}`) : ['- nenhuma']),
      '', '## Expulsões', ...(report.kicks.length ? report.kicks.map((k) => `- ${k.who}: ${k.reason}`) : ['- nenhuma'])
    ].join('\n') + '\n'
    fs.writeFileSync(path.join(OUT, 'report.md'), md)
    console.log('\n' + md)
    process.exit(0)
  }
}

main()
