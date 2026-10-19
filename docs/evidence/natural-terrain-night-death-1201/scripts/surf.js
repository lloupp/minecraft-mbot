const mineflayer = require('/home/user/minecraft-mbot/node_modules/mineflayer')
const { Vec3 } = require('/home/user/minecraft-mbot/node_modules/vec3')
const fs = require('fs'); const SO = process.env.SO
const C = (c) => fs.appendFileSync(SO + '/mcserver/in.fifo', c + '\n')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username: 'scanbot', version: '1.20.1', auth: 'offline' })
const ch = { stone: 'S', grass_block: 'g', dirt: 'd', water: '~', sand: 's', gravel: 'r', andesite: 'a', diorite: 'i', granite: 'n', coarse_dirt: 'c', snow_block: 'w', podzol: 'p' }
bot.once('spawn', async () => {
  C('forceload add -60 -210 10 -150'); C('tp scanbot -28 120 -180'); await sleep(7000)
  const top = (x, z) => { for (let y = 130; y > 30; y--) { const b = bot.blockAt(new Vec3(x, y, z)); if (b && b.name !== 'air' && !b.name.includes('leaves')) return [y, b.name] } return [0, '?'] }
  for (let z = -205; z <= -155; z += 2) { let row = ''; for (let x = -55; x <= 5; x += 2) { const [y, n] = top(x, z); row += ch[n] || '?' } console.log(String(z).padStart(5), row) }
  console.log('x from -55 step 2; heights:'); for (const [x, z] of [[-28,-180],[-20,-180],[-40,-180],[-28,-170],[-28,-190]]) console.log(x, z, JSON.stringify(top(x, z)))
  bot.quit(); process.exit(0)
})
setTimeout(() => process.exit(1), 60000)
