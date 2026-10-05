const mineflayer = require('/home/user/minecraft-mbot/node_modules/mineflayer'); const { Vec3 } = require('/home/user/minecraft-mbot/node_modules/vec3')
const fs=require('fs'); const C=(c)=>fs.appendFileSync(process.env.SO+'/mcserver/in.fifo',c+'\n'); const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const [cx,cy,cz]=process.argv.slice(2).map(Number)
const bot = mineflayer.createBot({ host:'127.0.0.1', port:25566, username:'colbot', version:'1.20.1', auth:'offline' })
bot.once('spawn', async () => { C(`tp colbot ${cx} 110 ${cz}`); await sleep(4000)
 const ab=n=>n==='air'?'.':n==='grass_block'?'G':n==='dirt'?'d':n==='stone'?'S':n.endsWith('leaves')?'L':n.endsWith('_log')?'T':n==='grass'?'g':n==='tall_grass'?'t':n.slice(0,1).toUpperCase()
 for (let y=cy+3;y>=cy-2;y--){ let rows=[]; for(let z=cz-2;z<=cz+2;z++){ let r=''; for(let x=cx-3;x<=cx+3;x++) r+=ab(bot.blockAt(new Vec3(x,y,z))?.name||'?'); rows.push(r)} console.log('y',y,rows.join(' | ')) }
 bot.quit(); process.exit(0) })
