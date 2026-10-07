const mineflayer = require('/home/user/minecraft-mbot/node_modules/mineflayer'); const { pathfinder, Movements, goals } = require('/home/user/minecraft-mbot/node_modules/mineflayer-pathfinder')
const fs=require('fs'); const C=(c)=>fs.appendFileSync(process.env.SO+'/mcserver/in.fifo',c+'\n'); const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const [x,y,z]=process.argv.slice(2).map(Number)
const bot = mineflayer.createBot({ host:'127.0.0.1', port:25566, username:'trapbot', version:'1.20.1', auth:'offline' }); bot.loadPlugin(pathfinder)
bot.once('spawn', async () => { C('effect give trapbot resistance 120 255 true'); C('clear trapbot')
  const mv=new Movements(bot); mv.canDig=true; mv.allow1by1towers=true; bot.pathfinder.setMovements(mv)
  for (const [dx,dz] of [[20,0],[-20,0],[0,20],[0,-20],[30,30]]) {
    C(`tp trapbot ${x} ${y} ${z}`); await sleep(2500)
    const g=new goals.GoalNear(x+dx, y, z+dz, 3); let r
    try { await Promise.race([bot.pathfinder.goto(g), sleep(20000).then(()=>{throw new Error('timeout15')})]); r='OK' } catch(e){ r=e.message.slice(0,30); bot.pathfinder.setGoal(null) }
    console.log('dir',dx,dz,r,'end',bot.entity.position.floored().toString()) }
  bot.quit(); process.exit(0) })
setTimeout(()=>process.exit(1),120000)
