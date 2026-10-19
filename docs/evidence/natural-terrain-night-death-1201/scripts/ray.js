const mineflayer = require('/home/user/minecraft-mbot/node_modules/mineflayer')
const { Vec3 } = require('/home/user/minecraft-mbot/node_modules/vec3')
const fs = require('fs'); const SO = process.env.SO
const C = (c) => fs.appendFileSync(SO + '/mcserver/in.fifo', c + '\n')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username: 'raybot', version: '1.20.1', auth: 'offline' })
bot.once('spawn', async () => {
  C('tp raybot -13.4 72 -177.5'); await sleep(4000)
  const P = (v) => v && `(${v.x},${v.y},${v.z})`
  console.log('bot', bot.entity.position.toString(), 'eye', bot.entity.position.offset(0, 1.62, 0).toString())
  for (const t of [[-16,71,-179],[-17,71,-178],[-17,71,-180],[-9,72,-178]]) {
    const pos = new Vec3(...t); const b = bot.blockAt(pos)
    await bot.lookAt(pos.offset(0.5, 0.5, 0.5), true)
    const cur = bot.blockAtCursor(5)
    console.log('target', P(pos), b && b.name, 'canDig', bot.canDigBlock(b), 'canSee', bot.canSeeBlock(b), 'cursor', cur && cur.name, P(cur && cur.position), 'above', bot.blockAt(pos.offset(0,1,0))?.name)
  }
  // perfil de blocos entre o bot e o alvo
  for (let x = -17; x <= -13; x++) console.log('x', x, [74,73,72,71].map(y => y + ':' + bot.blockAt(new Vec3(x, y, -179))?.name).join(' '))
  bot.quit(); process.exit(0)
})
setTimeout(() => process.exit(1), 40000)
