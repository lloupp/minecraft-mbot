const mineflayer = require('/home/user/minecraft-mbot/node_modules/mineflayer')
const { Vec3 } = require('/home/user/minecraft-mbot/node_modules/vec3')
const fs = require('fs'); const SO = process.env.SO
const C = (c) => fs.appendFileSync(SO + '/mcserver/in.fifo', c + '\n')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const [cx, cz] = [Number(process.argv[2]), Number(process.argv[3])]
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username: 'scanbot', version: '1.20.1', auth: 'offline' })
bot.once('spawn', async () => {
  C(`forceload add ${cx-48} ${cz-48} ${cx+48} ${cz+48}`); C(`tp scanbot ${cx} 120 ${cz}`); await sleep(6000)
  const ids = (n) => bot.registry.blocksByName[n]?.id
  const logs = bot.findBlocks({ matching: ['oak_log','birch_log','spruce_log'].map(ids).filter(Boolean), maxDistance: 48, count: 400 })
  const stone = bot.findBlocks({ matching: [ids('stone')], maxDistance: 48, count: 400 })
  const water = bot.findBlocks({ matching: [ids('water')], maxDistance: 48, count: 50 })
  console.log('logs', logs.length, 'stone', stone.length, 'water', water.length)
  // melhor ponto: log e stone expostos a ≤6 blocos entre si, no nível do chão
  let best = null
  for (const l of logs) {
    if (!bot.blockAt(l.offset(0,-1,0)) || ['air','water'].includes(bot.blockAt(l.offset(0,-1,0)).name)) continue
    for (const s of stone) {
      if (Math.abs(s.y - l.y) > 3) continue
      const d = Math.hypot(s.x - l.x, s.z - l.z); if (d > 6) continue
      const above = bot.blockAt(s.offset(0,1,0)); if (above && above.name !== 'air') continue
      if (!best || d < best.d) best = { l: l.toString(), s: s.toString(), d: +d.toFixed(1) }
    }
  }
  console.log('best', JSON.stringify(best))
  const top = (x, z) => { for (let y = 150; y > 30; y--) { const b = bot.blockAt(new Vec3(x, y, z)); if (b && b.name !== 'air' && !b.name.includes('leaves')) return [y, b.name] } }
  console.log('ground sample', top(cx, cz), top(cx + 10, cz), top(cx, cz + 10))
  bot.quit(); process.exit(0)
})
setTimeout(() => process.exit(1), 60000)
