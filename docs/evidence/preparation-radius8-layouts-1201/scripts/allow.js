const mineflayer = require('/home/user/minecraft-mbot/node_modules/mineflayer')
const gather = require('/home/user/minecraft-mbot/lib/gather.js')
const fs = require('fs'); const SO = process.env.SO
const C = (c) => fs.appendFileSync(SO + '/mcserver/in.fifo', c + '\n')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const [x,y,z,R]=process.argv.slice(2).map(Number)
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username: 'scanbot', version: '1.20.1', auth: 'offline' })
bot.once('spawn', async () => {
  C(`tp scanbot ${x} ${y} ${z}`); await sleep(4000)
  const blocks=bot.registry.blocksArray
  const ids=(p)=>blocks.filter(b=>p(b.name)).map(b=>b.id)
  const run=(p,count)=>{const out=[];for(const pos of bot.findBlocks({matching:ids(p),maxDistance:R,count})){const b=bot.blockAt(pos);const ex=gather.isExposed(bot,pos),fa=gather.hasFallingAbove(bot,pos);out.push(`${pos.x},${pos.y},${pos.z} ${b.name} exp=${ex} fall=${fa} d=${bot.entity.position.distanceTo(pos).toFixed(1)}`)}return out}
  console.log('LOGS'); run(n=>n.endsWith('_log'),128).forEach(l=>console.log(l))
  const st=run(n=>n==='stone'||n==='cobblestone',256); console.log('STONE total',st.length,'exposed',st.filter(s=>s.includes('exp=true')&&s.includes('fall=false')).length)
  st.filter(s=>s.includes('exp=true')).slice(0,8).forEach(l=>console.log(l))
  bot.quit(); process.exit(0)
})
