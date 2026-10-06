const mineflayer = require('/home/user/wt-exp/node_modules/mineflayer'); const { pathfinder, Movements, goals } = require('/home/user/wt-exp/node_modules/mineflayer-pathfinder')
const fs=require('fs'); const C=(c)=>fs.appendFileSync(process.env.SO+'/mcserver/in.fifo',c+'\n'); const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const bot = mineflayer.createBot({ host:'127.0.0.1', port:25566, username:'respbot', version:'1.20.1', auth:'offline' }); bot.loadPlugin(pathfinder)
let ticks=0; bot.on('physicsTick',()=>ticks++)
const P=v=>[+v.x.toFixed(1),+v.y.toFixed(1),+v.z.toFixed(1)]
async function walk(label){ const mv=new Movements(bot); mv.canDig=false; bot.pathfinder.setMovements(mv); const from=bot.entity.position.clone(); const t0=ticks
  let r; try { await Promise.race([bot.pathfinder.goto(new goals.GoalNear(from.x+12,from.y,from.z,2)), sleep(15000).then(()=>{throw new Error('t15')})]); r='OK' } catch(e){ r=e.message.slice(0,30); bot.pathfinder.setGoal(null) }
  console.log(label, r, 'moved', from.distanceTo(bot.entity.position).toFixed(1), 'physicsTicks', ticks-t0) }
bot.once('spawn', async () => { C('tp respbot 245.5 70 -100.5'); await sleep(3000)
  await walk('antes da morte')
  C('kill respbot'); await sleep(2500)
  console.log('isAlive', bot.isAlive, 'health', bot.health)
  await sleep(3000)
  console.log('depois do respawn pos', P(bot.entity.position), 'health', bot.health)
  await walk('depois do respawn')
  bot.quit(); process.exit(0) })
setTimeout(()=>process.exit(1),60000)
