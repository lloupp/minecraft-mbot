// Benchmark fixo de navegação: mesmas origens e mesmos alvos, mundo restaurado, sem monstros, dia travado.
// Usa a navegação real do WorkerController (explore com groundAware e returnHome com verificação).
// uso: CODE=<worktree> PORT=<porta> FIFO=<in.fifo do servidor> OUT=<arquivo jsonl> node navbench.js
const CODE = process.env.CODE
const fs = require('fs')
const mineflayer = require(CODE + '/node_modules/mineflayer')
const { pathfinder } = require(CODE + '/node_modules/mineflayer-pathfinder')
const { WorkerController } = require(CODE + '/core/WorkerController')
const { loadPlugins } = require(CODE + '/lib/plugins')
const C = (c) => fs.appendFileSync(process.env.FIFO, c + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const HOME = { x: 240, y: 63, z: -110 }
const out = (row) => fs.appendFileSync(process.env.OUT, JSON.stringify(row) + '\n')
const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(process.env.PORT), username: 'navbench', version: '1.20.1', auth: 'offline' })
bot.loadPlugin(pathfinder); loadPlugins(bot, { log: () => {} })
const w = new WorkerController({ bot, name: 'navbench', role: 'explorador', homeProvider: () => HOME, logger: { log: (m) => fs.appendFileSync(process.env.OUT + '.log', m + '\n') } })
// origens fixas (x,z) em volta da base; superfície via spreadplayers
const STARTS = [[240, -110], [264, -110], [216, -110], [240, -86], [240, -134], [288, -62], [192, -158], [288, -158], [192, -62]]
bot.once('spawn', async () => {
  await sleep(3000)
  C('gamerule doMobSpawning false'); C('gamerule doDaylightCycle false'); C('time set 1000'); C('weather clear'); C('kill @e[type=!player]')
  C('gamemode survival navbench'); C('effect give navbench resistance 100000 255 true'); C('effect give navbench saturation 100000 1 true')
  let trial = 0
  const run = async (kind, start, fn) => {
    C(`spreadplayers ${start[0]} ${start[1]} 0 2 false navbench`); await sleep(4000)
    C('clear navbench'); await sleep(500)
    const from = bot.entity.position.clone(); const t0 = Date.now(); let res = null; let error = null
    try { res = await fn() } catch (e) { error = (e?.message || String(e)).slice(0, 80) }
    bot.pathfinder.setGoal(null)
    const end = bot.entity.position
    const row = { trial: trial++, kind, start, from: [from.x, from.y, from.z].map((v) => +v.toFixed(1)), ms: Date.now() - t0,
      ok: Boolean(res?.ok) && !error, error, target: res && Number.isFinite(res.x) ? [res.x, res.y, res.z] : null, code: res?.code || null,
      end: [end.x, end.y, end.z].map((v) => +v.toFixed(1)), homeDist: +end.distanceTo(HOME).toFixed(1) }
    out(row); console.log(JSON.stringify(row))
  }
  for (let s = 0; s < STARTS.length; s++) {
    for (const step of [s, s + 3]) {
      await run('explore', STARTS[s], () => { w.exploreStep = step; return w.explore(64, () => false, HOME, { groundAware: true }) })
    }
    if (s > 0) await run('return', STARTS[s], () => w.returnHome(() => false, { verify: true }))
  }
  bot.quit(); setTimeout(() => process.exit(0), 1000)
})
bot.on('kicked', (r) => { console.log('kicked', r); process.exit(2) })
setTimeout(() => { console.log('timeout global'); process.exit(3) }, 40 * 60 * 1000)
