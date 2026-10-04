const mineflayer = require('/home/user/minecraft-mbot/node_modules/mineflayer')
const { pathfinder, Movements } = require('/home/user/minecraft-mbot/node_modules/mineflayer-pathfinder')
const { Vec3 } = require('/home/user/minecraft-mbot/node_modules/vec3')
const food = require('/home/user/minecraft-mbot/lib/food'); const gatherLib = null
const fs = require('fs'); const SO = process.env.SO
const C = (c) => fs.appendFileSync(SO + '/mcserver/in.fifo', c + '\n')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const [TX,TY,TZ,SX,SY,SZ,N]=process.argv.slice(2).map(Number)   // tree origin, standing pos, trials
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username: 'nooktest', version: '1.20.1', auth: 'offline' })
bot.loadPlugin(pathfinder)
const P = (v) => v && [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]
bot.once('spawn', async () => {
  const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = true; bot.pathfinder.setMovements(mv)
  const og = bot.pathfinder.goto.bind(bot.pathfinder)
  bot.pathfinder.goto = async (goal) => {
    const t = Date.now(); const from = P(bot.entity.position)
    try { await og(goal); console.log('  goto OK', [goal.x, goal.y, goal.z], 'r', goal.rangeSq !== undefined ? Math.sqrt(goal.rangeSq) : '-', 'from', from, 'to', P(bot.entity.position), Date.now() - t, 'ms') }
    catch (e) { console.log('  goto ERR', e.message, [goal.x, goal.y, goal.z], 'from', from, 'to', P(bot.entity.position), Date.now() - t, 'ms'); throw e }
  }
  const results = []
  for (let k = 0; k < N; k++) {
    C(`fill ${TX-6} 72 ${TZ-6} ${TX+6} 90 ${TZ+6} air`); await sleep(800)
    C(`place feature minecraft:${process.argv[9]||'oak'} ${TX} ${TY} ${TZ}`); C(`tp nooktest ${SX} ${SY} ${SZ}`); C('clear nooktest'); C('give nooktest stone_axe 1'); await sleep(2500)
    const target = bot.blockAt(new Vec3(TX, TY, TZ))
    const before = () => bot.inventory.items().filter(i => i.name.endsWith('_log')).reduce((n, i) => n + i.count, 0)
    const b0 = before()
    await bot.equip(bot.inventory.items().find(i=>i.name==='stone_axe'),'hand'); await bot.dig(target)
    const t0 = Date.now()
    const m = e => e.getDroppedItem?.()?.name?.endsWith('_log')
    await food.collectDrops(bot, target.position, () => false, { timeoutMs: 3000, matches: m, done: () => before() > b0 })
    let ok = before() > b0
    if (!ok) { console.log(' second pass'); await food.collectDrops(bot, target.position, () => false, { timeoutMs: 3000, matches: m, done: () => before() > b0 }); ok = before() > b0 }
    const drops = Object.values(bot.entities).filter(e => e.name === 'item').map(e => ({ p: P(e.position), d: +e.position.distanceTo(bot.entity.position).toFixed(2) }))
    const around = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dz])=>`${dx},${dz}:${bot.blockAt(new Vec3(TX+dx,TY,TZ+dz))?.name}/${bot.blockAt(new Vec3(TX+dx,TY+1,TZ+dz))?.name}`).join(' ')
    console.log('trial', k, 'RESULT', ok, 'ms', Date.now() - t0, 'bot', P(bot.entity.position), 'drops left', JSON.stringify(drops), '| around', around)
    results.push(ok)
  }
  console.log('SUMMARY', results.filter(Boolean).length + '/' + results.length)
  bot.quit(); process.exit(0)
})
bot.on('error', e => console.log('err', e.message)); bot.on('kicked', r => console.log('kick', r))
setTimeout(() => process.exit(1), 200000)
