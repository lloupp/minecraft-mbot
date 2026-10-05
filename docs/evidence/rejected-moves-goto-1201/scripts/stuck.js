const mineflayer = require('/home/user/minecraft-mbot/node_modules/mineflayer'); const { Vec3 } = require('/home/user/minecraft-mbot/node_modules/vec3')
const fs=require('fs'); const C=(c)=>fs.appendFileSync(process.env.SO+'/mcserver/in.fifo',c+'\n'); const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const [x,y,z]=process.argv.slice(2).map(Number)
const bot = mineflayer.createBot({ host:'127.0.0.1', port:25566, username:'legbot', version:'1.20.1', auth:'offline' })
bot.once('spawn', async () => { C(`tp legbot ${x} ${y} ${z}`); await sleep(3000)
  let ticks=0; bot.on('physicsTick',()=>ticks++); await sleep(2000)
  const p=bot.entity.position
  console.log('pos',p.toString(),'ticks/2s',ticks,'onGround',bot.entity.onGround,'vel',bot.entity.velocity.toString(),'col',!!bot.world.getColumnAt(p))
  for (let dy=-1;dy<=2;dy++) for (let dx=-1;dx<=1;dx++) for (let dz=-1;dz<=1;dz++){ const b=bot.blockAt(p.floored().offset(dx,dy,dz)); if(b && b.boundingBox!=='empty') console.log(' solid',dx,dy,dz,b.name,JSON.stringify(b.shapes)) }
  bot.setControlState('forward',true); bot.look(0,0,true); await sleep(1500); bot.setControlState('forward',false)
  console.log('after forward', bot.entity.position.toString(),'ticks',ticks)
  bot.quit(); process.exit(0) })
