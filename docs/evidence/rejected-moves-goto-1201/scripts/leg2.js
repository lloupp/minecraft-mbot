const mineflayer = require('/home/user/minecraft-mbot/node_modules/mineflayer'); const { pathfinder, Movements, goals } = require('/home/user/minecraft-mbot/node_modules/mineflayer-pathfinder')
const fs=require('fs'); const C=(c)=>fs.appendFileSync(process.env.SO+'/mcserver/in.fifo',c+'\n'); const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const [sx,sy,sz,gx,gy,gz,N]=process.argv.slice(2).map(Number)
const bot = mineflayer.createBot({ host:'127.0.0.1', port:25566, username:'legbot', version:'1.20.1', auth:'offline' }); bot.loadPlugin(pathfinder)
const P=v=>[+v.x.toFixed(1),+v.y.toFixed(1),+v.z.toFixed(1)]
bot.once('spawn', async () => {
  const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = true; bot.pathfinder.setMovements(mv)
  for (let k=0;k<N;k++){ C('clear legbot'); C(`tp legbot ${sx} ${sy} ${sz}`); await sleep(2500)
    const t0=Date.now(); const trace=[]; const iv=setInterval(()=>trace.push({p:P(bot.entity.position),g:bot.entity.onGround,v:P(bot.entity.velocity),c:Object.entries(bot.controlState).filter(([k,v])=>v).map(([k])=>k).join('+'),here:bot.blockAt(bot.entity.position)?.name,ph:bot.physicsEnabled}),3000); let upd=[]; const u=r=>{ if(upd.length<12) upd.push(r.status+':'+r.path.length)}; bot.on('path_update',u)
    let res
    try { await Promise.race([bot.pathfinder.goto(new goals.GoalNear(gx,gy,gz,3)), sleep(30000).then(()=>{throw new Error('timeout30')})]); res='OK' } catch(e){ res=e.message.slice(0,30); bot.pathfinder.setGoal(null) }
    clearInterval(iv); bot.removeListener('path_update',u)
    console.log('trial',k,res,Date.now()-t0,'ms end',P(bot.entity.position),'trace',JSON.stringify(trace),'upd',upd.join(','))
  }
  bot.quit(); process.exit(0) })
setTimeout(()=>process.exit(1), 40000*Number(process.argv[8])+20000)
