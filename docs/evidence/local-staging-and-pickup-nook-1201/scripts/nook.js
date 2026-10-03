const mineflayer = require('/home/user/minecraft-mbot/node_modules/mineflayer')
const { pathfinder, Movements, goals } = require('/home/user/minecraft-mbot/node_modules/mineflayer-pathfinder')
const { Vec3 } = require('/home/user/minecraft-mbot/node_modules/vec3')
const food = require('/home/user/minecraft-mbot/lib/food')
const fs = require('fs'); const SO = process.env.SO
const C = (c) => fs.appendFileSync(SO + '/mcserver/in.fifo', c + '\n')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username: 'nooktest', version: '1.20.1', auth: 'offline' })
bot.loadPlugin(pathfinder)
const P = (v) => v && [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]
bot.once('spawn', async () => {
  const mv = new Movements(bot); mv.canDig = false; bot.pathfinder.setMovements(mv)
  const og = bot.pathfinder.goto.bind(bot.pathfinder)
  bot.pathfinder.goto = async (goal) => {
    const t = Date.now(); const from = P(bot.entity.position)
    try { await og(goal); console.log('  goto OK', [goal.x, goal.y, goal.z], 'r', goal.rangeSq !== undefined ? Math.sqrt(goal.rangeSq) : '-', 'from', from, 'to', P(bot.entity.position), Date.now() - t, 'ms') }
    catch (e) { console.log('  goto ERR', e.message, [goal.x, goal.y, goal.z], 'r', goal.rangeSq !== undefined ? Math.sqrt(goal.rangeSq) : '-', 'from', from, 'to', P(bot.entity.position), Date.now() - t, 'ms'); throw e }
  }
  const results = []
  for (let k = 0; k < 12; k++) {
    const bx = 270 + k * 6
    C('tp nooktest ' + (bx + 3.5) + ' 200 -300.5'); C('fill ' + (bx - 2) + ' 200 -305 ' + (bx + 6) + ' 204 -295 minecraft:air'); await sleep(1200)
    C('give nooktest stone_axe 1')
    for (let y = 200; y <= 202; y++) C('setblock ' + bx + ' ' + y + ' -300 minecraft:oak_log')
    await sleep(1500)
    bot.entity.position // ensure
    const target = bot.blockAt(new Vec3(bx, 200, -300))
    const before = () => bot.inventory.items().filter(i => i.name === 'oak_log').reduce((n, i) => n + i.count, 0)
    const b0 = before()
    await bot.dig(target)
    console.log('round', k, 'dug; bot', P(bot.entity.position))
    const t0 = Date.now()
    await food.collectDrops(bot, target.position, () => false, { timeoutMs: 3000, matches: e => e.getDroppedItem?.()?.name === 'oak_log', done: () => before() > b0 })
    let ok = before() > b0
    if (!ok) { console.log(' second pass'); await food.collectDrops(bot, target.position, () => false, { timeoutMs: 3000, matches: e => e.getDroppedItem?.()?.name === 'oak_log', done: () => before() > b0 }); ok = before() > b0 }
    const drops = Object.values(bot.entities).filter(e => e.name === 'item').map(e => ({ p: P(e.position), d: +e.position.distanceTo(bot.entity.position).toFixed(2) }))
    console.log(' RESULT', ok, 'ms', Date.now() - t0, 'bot', P(bot.entity.position), 'drops left', JSON.stringify(drops))
    results.push(ok)
  }
  console.log('SUMMARY', results.filter(Boolean).length + '/' + results.length)
  bot.quit(); process.exit(0)
})
bot.on('error', e => console.log('err', e.message)); bot.on('kicked', r => console.log('kick', r))
setTimeout(() => process.exit(1), 150000)
