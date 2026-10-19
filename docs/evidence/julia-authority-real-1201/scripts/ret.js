const mineflayer = require('/home/user/minecraft-mbot/node_modules/mineflayer'); const { pathfinder, Movements, goals } = require('/home/user/minecraft-mbot/node_modules/mineflayer-pathfinder')
const fs=require('fs'); const C=(c)=>fs.appendFileSync(process.env.SO+'/mcserver/in.fifo',c+'\n'); const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const bot = mineflayer.createBot({ host:'127.0.0.1', port:25566, username:'retbot', version:'1.20.1', auth:'offline' }); bot.loadPlugin(pathfinder)
const P=v=>[+v.x.toFixed(1),+v.y.toFixed(1),+v.z.toFixed(1)]
bot.once('spawn', async () => { C('effect give retbot resistance 300 255 true'); C('effect give retbot saturation 300 1 true')
  const mv=new Movements(bot); mv.canDig=false; mv.allow1by1towers=true; bot.pathfinder.setMovements(mv); bot.pathfinder.tickTimeout=40
  for (const [x,y,z] of [[283.5,63,-156.5],[284.5,62,-161.6]]) { C(`tp retbot ${x} ${y} ${z}`); await sleep(3000)
    const t0=Date.now(); let r; const upd=[]; const u=(p)=>{ if(upd.length<6) upd.push(p.status+':'+p.path.length)}; bot.on('path_update',u)
    try { await Promise.race([bot.pathfinder.goto(new goals.GoalNear(240,63,-110,3)), sleep(60000).then(()=>{throw new Error('t60')})]); r='OK' } catch(e){ r=e.message.slice(0,40); bot.pathfinder.setGoal(null) }
    bot.removeListener('path_update',u)
    console.log('from',x,z,'->',r,Date.now()-t0,'ms end',P(bot.entity.position),'dist',bot.entity.position.distanceTo({x:240,y:63,z:-110}).toFixed(1),upd.join(',')) }
  bot.quit(); process.exit(0) })
setTimeout(()=>process.exit(1),150000)
