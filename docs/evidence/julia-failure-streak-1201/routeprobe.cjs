const R = '/home/user/minecraft-mbot/node_modules/'
const mineflayer = require(R + 'mineflayer')
const { pathfinder, Movements, goals } = require(R + 'mineflayer-pathfinder')
const fs = require('fs'), readline = require('readline')
const out = (o) => fs.appendFileSync('/tmp/run/routeprobe.jsonl', JSON.stringify(o) + '\n')
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username: 'route_probe', version: '1.20.1', auth: 'offline' })
bot.loadPlugin(pathfinder)
bot.on('spawn', () => out({ ev: 'spawn', pos: bot.entity.position }))
bot.on('error', (e) => out({ ev: 'error', m: e.message })); bot.on('end', () => { out({ ev: 'end' }); process.exit() })
function moves(v) {
  const m = new Movements(bot)
  m.canDig = false; m.allow1by1towers = true            // = workMoves do WorkerController
  if (v === 'dig') m.canDig = true
  if (v === 'restrictive') { m.allow1by1towers = false; m.allowParkour = false }
  if (v === 'nodig_noparkour') { m.allowParkour = false }
  if (v === 'dig_notowers') { m.canDig = true; m.allow1by1towers = false }
  return m
}
const queue = []; let busy = false
async function drain() {
  if (busy) return; busy = true
  while (queue.length) {
    const l = queue.shift()
    const [cmd, label, x, y, z, radius, ...vs] = l.trim().split(/\s+/)
    if (cmd === 'go') {
      const goal = new goals.GoalBlock(+x, +y, +z); const v = vs[0] || 'default'; const t0 = Date.now()
      bot.pathfinder.thinkTimeout = 10000; bot.pathfinder.tickTimeout = 8; bot.pathfinder.setMovements(moves(v))
      let err = null
      try { await Promise.race([bot.pathfinder.goto(goal), new Promise((_, rej) => setTimeout(() => { bot.pathfinder.setGoal(null); rej(new Error('outer-timeout-20s')) }, 20000))]) } catch (e) { err = String(e.message || e) }
      const p2 = bot.entity.position
      out({ ev: 'go', label, variant: v, error: err, final: { x: +p2.x.toFixed(2), y: +p2.y.toFixed(2), z: +p2.z.toFixed(2) }, dist_to_goal: +p2.distanceTo(new (require(R + 'vec3').Vec3)(+x + 0.5, +y, +z + 0.5)).toFixed(2), ms: Date.now() - t0 })
      continue
    }
    if (cmd !== 'path') continue
    const goal = radius && +radius > 0 ? new goals.GoalNear(+x, +y, +z, +radius) : new goals.GoalBlock(+x, +y, +z)
    for (const v of (vs.length ? vs : ['default', 'dig', 'restrictive'])) {
      const t0 = Date.now(); let result = null, steps = 0
      try {
        for (const { result: r } of bot.pathfinder.getPathFromTo(moves(v), bot.entity.position, goal, { timeout: 10000, tickTimeout: 40 })) { result = r; steps++; if (r.status !== 'partial') break }
        out({ ev: 'path', label, variant: v, from: bot.entity.position, goal: { x: +x, y: +y, z: +z, radius: +radius || 0 }, status: result.status, length: result.path ? result.path.length : null, cost: result.cost, visited: result.visitedNodes, generated: result.generatedNodes, steps, ms: Date.now() - t0 })
      } catch (e) { out({ ev: 'path', label, variant: v, error: String(e.message || e), ms: Date.now() - t0 }) }
      await new Promise((r) => setTimeout(r, 50))
    }
  }
  busy = false
}
readline.createInterface({ input: fs.createReadStream('/tmp/run/routeprobe.fifo') }).on('line', (l) => { queue.push(l); drain() })
