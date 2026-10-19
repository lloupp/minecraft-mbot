const mineflayer = require('/home/user/wt-fix/node_modules/mineflayer'); const night = require('/home/user/wt-fix/lib/night')
const fs=require('fs'); const C=(c)=>fs.appendFileSync(process.env.SO+'/mcserver/in.fifo',c+'\n'); const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const bot = mineflayer.createBot({ host:'127.0.0.1', port:25566, username:'costbot', version:'1.20.1', auth:'offline' })
bot.once('spawn', async () => { C('clear costbot'); C('tp costbot 240.5 64 -109.5'); C('effect give costbot resistance 60 255 true'); await sleep(5000)
  for (const r of [8,12,16,24]) { const t=process.hrtime.bigint(); const s=night.findShelterSpot(bot,{radius:r}); console.log('r',r,String(s), (Number(process.hrtime.bigint()-t)/1e6).toFixed(1),'ms') }
  bot.quit(); process.exit(0) })
setTimeout(()=>process.exit(1),40000)
