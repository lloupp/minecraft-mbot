const mineflayer = require('/home/user/minecraft-mbot/node_modules/mineflayer'); const { pathfinder, Movements, goals } = require('/home/user/minecraft-mbot/node_modules/mineflayer-pathfinder')
const fs=require('fs'); const C=(c)=>fs.appendFileSync(process.env.SO+'/mcserver/in.fifo',c+'\n'); const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const [sx,sy,sz,gx,gy,gz,N]=process.argv.slice(2).map(Number); const MODE=process.env.MODE
const bot = mineflayer.createBot({ host:'127.0.0.1', port:25566, username:'legbot', version:'1.20.1', auth:'offline' }); bot.loadPlugin(pathfinder)
const P=v=>[+v.x.toFixed(1),+v.y.toFixed(1),+v.z.toFixed(1)]
function goWatch(goal, ms) { return new Promise((res, rej) => { let n=0, at=null, last=0
  const f=()=>{ const now=Date.now(), p=bot.entity.position; if(!at||now-last>500||p.distanceTo(at)>0.5){at=p.clone(); n=0} last=now; if(++n>=40){ cleanup(); bot.pathfinder.setGoal(null); rej(new Error('rejected')) } }
  const t=setTimeout(()=>{cleanup(); bot.pathfinder.setGoal(null); rej(new Error('timeout'))},ms)
  const cleanup=()=>{clearTimeout(t); bot.removeListener('forcedMove',f)}
  bot.on('forcedMove',f); bot.pathfinder.goto(goal).then(()=>{cleanup();res()},e=>{cleanup();rej(e)}) }) }
bot.once('spawn', async () => {
  const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = true; bot.pathfinder.setMovements(mv)
  for (let k=0;k<N;k++){ C(`tp legbot ${sx} ${sy} ${sz}`); await sleep(2500); const t0=Date.now(); const log=[]
    const goal=new goals.GoalNear(gx,gy,gz,3)
    for (let a=0;a<3;a++){ try { await goWatch(goal, 30000-(Date.now()-t0)); log.push('OK'); break } catch(e){ log.push(e.message+'@'+(Date.now()-t0)+P(bot.entity.position)); if(e.message!=='rejected'||MODE==='failfast') break; bot.clearControlStates(); await bot.waitForTicks(5) } }
    console.log('trial',k,log.join(' > '),'total',Date.now()-t0,'end',P(bot.entity.position)) }
  bot.quit(); process.exit(0) })
setTimeout(()=>process.exit(1), 40000*N+20000)
