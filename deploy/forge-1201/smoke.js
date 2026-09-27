const fs = require('node:fs')
const { performance } = require('node:perf_hooks')
const mineflayer = require('mineflayer')
const { pathfinder } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const { configureClient, detectProfile } = require('../../lib/serverProfile')
const { createBot } = require('../../lib/botFactory')
const { loadPlugins } = require('../../lib/plugins')
const { WorkerController } = require('../../core/WorkerController')
fs.mkdirSync('.data/forge-p0', { recursive: true })
const file = '.data/forge-p0/smoke-evidence.json'
const report = { startedAt: new Date().toISOString(), minecraftVersion: '1.20.1', profile: 'forge', port: 25586, bots: [], navigation: [], samples: [], limitations: ['No collection/crafting/furnace/build/combat/restart tested', 'Short natural-terrain navigation only'] }
const bots = []
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function snapshot(bot) {
  return { name: bot.username, position: bot.entity ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } : null, dimension: bot.game?.dimension, gameMode: bot.game?.gameMode, health: bot.health, food: bot.food, version: bot.version }
}
function save() { fs.writeFileSync(file, JSON.stringify(report, null, 2)) }
async function connect(name, role) {
  const bot = createBot(mineflayer, { host: '127.0.0.1', port: 25586, username: name, version: '1.20.1', auth: 'offline' })
  bots.push(bot)
  configureClient(bot, detectProfile('1.20.1', 'forge'))
  if (role) {
    bot.loadPlugin(pathfinder)
    loadPlugins(bot)
    bot.colonyController = new WorkerController({ bot, name, role, homeProvider: () => null, ownerProvider: () => null })
  }
  bot.on('error', err => { report.samples.push({ at: new Date().toISOString(), name, error: err.message }); save() })
  bot.on('kicked', reason => { report.samples.push({ at: new Date().toISOString(), name, kicked: String(reason) }); save() })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name}: spawn timeout`)), 30000)
    bot.once('spawn', () => { clearTimeout(timer); resolve() })
    bot.once('error', err => { clearTimeout(timer); reject(err) })
    bot.once('end', reason => { clearTimeout(timer); reject(new Error(`${name}: ${reason}`)) })
  })
  await bot.waitForChunksToLoad()
  report.bots.push(snapshot(bot)); save()
  return bot
}
function target(bot, sign) {
  const p = bot.entity.position.floored()
  for (const d of [6, 8, 12, 16]) for (const [dx, dz] of [[sign,0],[0,sign],[sign,sign],[-sign,0],[0,-sign]]) for (let dy = -6; dy <= 10; dy++) {
    const point = p.offset(dx * d, dy, dz * d)
    const feet = bot.blockAt(point); const head = bot.blockAt(point.offset(0, 1, 0)); const floor = bot.blockAt(point.offset(0, -1, 0))
    if (feet?.name === 'air' && head?.name === 'air' && floor?.boundingBox === 'block' && !['magma_block', 'cactus'].includes(floor.name)) return point
  }
  throw new Error(`${bot.username}: no safe loaded target`)
}
const watchdog = setTimeout(() => { report.failure = 'SESSION_TIMEOUT'; save(); for (const b of bots) b.quit(); process.exit(1) }, 90000)
;(async () => {
  try {
    await connect('eduardo_bot')
    const workers = await Promise.all([connect('lenhador_01', 'lenhador'), connect('minerador_01', 'minerador')])
    const sampleTimer = setInterval(() => { report.samples.push({ at: new Date().toISOString(), bots: bots.map(snapshot) }); save() }, 1000)
    try {
      const cpu = process.cpuUsage(); const start = performance.now()
      report.navigation = await Promise.all(workers.map(async (bot, i) => {
        const goal = target(bot, i === 0 ? 1 : -1)
        const before = snapshot(bot); const began = performance.now()
        try {
          const result = await bot.colonyController.run({ type: 'ir_local', position: goal })
          const distance = bot.entity.position.distanceTo(new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5))
          return { name: bot.username, before, goal, result, after: snapshot(bot), distance, verified: distance <= 2.01 && bot.health > 0, elapsedMs: performance.now() - began }
        } catch (err) { return { name: bot.username, before, goal, after: snapshot(bot), verified: false, error: err.message } }
      }))
      await sleep(3000)
      const used = process.cpuUsage(cpu)
      report.cpu = { ...used, wallMs: performance.now() - start, percentOneCore: (used.user + used.system) / ((performance.now() - start) * 1000) * 100 }
      report.ok = report.navigation.length === 2 && report.navigation.every(n => n.verified)
    } finally { clearInterval(sampleTimer) }
  } catch (err) { report.failure = err.message; report.ok = false }
  finally {
    clearTimeout(watchdog)
    report.finishedAt = new Date().toISOString(); save()
    for (const bot of bots) { bot.colonyController?.cancel(); bot.quit() }
    console.log(JSON.stringify(report, null, 2))
    setTimeout(() => process.exit(report.ok ? 0 : 1), 1000)
  }
})()
