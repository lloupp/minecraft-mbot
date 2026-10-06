const mineflayer = require('/home/user/wt-exp/node_modules/mineflayer')
const food = require('/home/user/wt-exp/lib/food'); const night = require('/home/user/wt-exp/lib/night')
const fs=require('fs'); const C=(c)=>fs.appendFileSync(process.env.SO+'/mcserver/in.fifo',c+'\n'); const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const bot = mineflayer.createBot({ host:'127.0.0.1', port:25566, username:'costbot', version:'1.20.1', auth:'offline' })
bot.once('spawn', async () => { C('tp costbot 273 72 -122'); C('effect give costbot resistance 60 255 true'); await sleep(5000)
  for (const [name, fn] of [['findFoodSource', () => food.findFoodSource(bot)], ['findShelterSpot', () => night.findShelterSpot(bot)], ['findBed', () => night.findBed(bot)]]) {
    const t=process.hrtime.bigint(); fn(); console.log(name, Number(process.hrtime.bigint()-t)/1e6, 'ms') }
  bot.quit(); process.exit(0) })
setTimeout(()=>process.exit(1),40000)
