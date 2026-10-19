const mineflayer = require('/home/user/minecraft-mbot/node_modules/mineflayer')
const { Vec3 } = require('/home/user/minecraft-mbot/node_modules/vec3')
const fs = require('fs'); const SO = process.env.SO
const C = (c) => fs.appendFileSync(SO + '/mcserver/in.fifo', c + '\n')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const [cx, cz] = [Number(process.argv[2]), Number(process.argv[3])]
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username: 'scanbot', version: '1.20.1', auth: 'offline' })
bot.once('spawn', async () => {
  C(`forceload add ${cx-60} ${cz-60} ${cx+60} ${cz+60}`); C(`tp scanbot ${cx} 110 ${cz}`); await sleep(7000)
  const stoneId = bot.registry.blocksByName.stone.id
  const ps = bot.findBlocks({ matching: [stoneId], maxDistance: 60, count: 20000 })
  const exposed = ps.filter(p => { const a = bot.blockAt(p.offset(0,1,0)); return a && a.name === 'air' })
  const grass = (x, z) => { for (let y = 120; y > 30; y--) { const b = bot.blockAt(new Vec3(x, y, z)); if (b && b.name !== 'air' && !b.name.includes('leaves')) return y } }
  // agrupa em células 6x6
  const cells = {}
  for (const p of exposed) { const k = Math.floor(p.x/6) + ',' + Math.floor(p.z/6); (cells[k] ||= []).push(p) }
  const top = Object.entries(cells).sort((a, b) => b[1].length - a[1].length).slice(0, 5)
  for (const [k, v] of top) { const p = v[0]; console.log('cell', k, 'exposed stone', v.length, 'e.g.', p.toString(), 'ground y', grass(p.x, p.z)) }
  console.log('total exposed', exposed.length)
  bot.quit(); process.exit(0)
})
setTimeout(() => process.exit(1), 60000)
