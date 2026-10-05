const mineflayer = require('/home/user/minecraft-mbot/node_modules/mineflayer'); const { Vec3 } = require('/home/user/minecraft-mbot/node_modules/vec3')
const fs=require('fs'); const C=(c)=>fs.appendFileSync(process.env.SO+'/mcserver/in.fifo',c+'\n'); const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const bot = mineflayer.createBot({ host:'127.0.0.1', port:25566, username:'colbot', version:'1.20.1', auth:'offline' })
bot.once('spawn', async () => { C('tp colbot -2 100 -200'); await sleep(4000)
 const top=(x,z)=>{for(let y=95;y>60;y--){const b=bot.blockAt(new Vec3(x,y,z)); if(b&&b.name!=='air') return y+':'+b.name.replace('_block','').slice(0,6)} return '-'}
 for (const z of [-212,-205,-196,-190,-180]) console.log('z',z, [-4,-3,-2,-1,0,1,2,3,4,5,6,7,8].map(x=>x+'='+top(x,z)).join(' '))
 bot.quit(); process.exit(0) })
