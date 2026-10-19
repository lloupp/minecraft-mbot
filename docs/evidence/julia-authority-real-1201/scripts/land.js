const mineflayer = require('/home/user/minecraft-mbot/node_modules/mineflayer'); const { Vec3 } = require('/home/user/minecraft-mbot/node_modules/vec3')
const fs=require('fs'); const C=(c)=>fs.appendFileSync(process.env.SO+'/mcserver/in.fifo',c+'\n'); const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const pts=process.argv.slice(2).map(s=>s.split(',').map(Number))
const bot = mineflayer.createBot({ host:'127.0.0.1', port:25566, username:'landbot', version:'1.20.1', auth:'offline' })
bot.once('spawn', async () => { C('gamemode spectator landbot')
  for (const [cx,cz] of pts) {
    C(`tp landbot ${cx} 120 ${cz}`)
    for (let i=0;i<40;i++){ await sleep(500); const p=bot.entity.position; if (Math.abs(p.x-cx)<2&&Math.abs(p.z-cz)<2) break }
    await sleep(5000)
    let land=0,water=0,unk=0,logs=0,stoneExp=0; const tops={}
    for (let dx=-32;dx<=32;dx+=4) for (let dz=-32;dz<=32;dz+=4){ let found=null
      for (let y=110;y>40;y--){ const b=bot.blockAt(new Vec3(cx+dx,y,cz+dz)); if(!b){unk++;found='?';break} if(b.name==='air'||b.name.includes('grass')&&b.boundingBox==='empty') continue; found=b.name; break }
      if(found==='?') continue; if(found==='water') water++; else land++; if(found?.endsWith('_log')||found?.endsWith('_leaves')) logs++; if(found==='stone') stoneExp++; tops[found]=(tops[found]||0)+1 }
    const top=Object.entries(tops).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>k+':'+v).join(' ')
    console.log('PT',cx,cz,'land',land,'water',water,'unknown',unk,'trees',logs,'stoneTop',stoneExp,'|',top)
  }
  bot.quit(); process.exit(0) })
setTimeout(()=>process.exit(1), 30000*pts.length+20000)
