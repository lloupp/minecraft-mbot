const fs = require('node:fs')
const { performance } = require('node:perf_hooks')
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const { configureClient, detectProfile } = require('../../../lib/serverProfile')
const { createBot } = require('../../../lib/botFactory')
const { loadPlugins } = require('../../../lib/plugins')
const { WorkerController } = require('../../../core/WorkerController')
const { StorageManager } = require('../../../core/StorageManager')
const report = { startedAt: new Date().toISOString(), minecraftVersion:'1.20.1', forgeVersion:'47.4.10', server:'127.0.0.1:25586', mode:'survival', intervention:'Small setblock keep fixture, thin snow cleared in survival. Tools crafted in survival from declared stock. Real findBlocks scoped to declared positions (position predicate inside findBlocks, not post-filtering a truncated list); no give, Creative or OP. Collection runs without auto-deposit to retain inventory proof.', tasks:[], events:[] }
const cpuStart=process.cpuUsage();const wallStart=performance.now();
const out=process.env.COLLECTION_REPORT || '.data/forge-p0/collection/normal-final.json'; const bots=[]
fs.mkdirSync(require('node:path').dirname(out),{recursive:true})
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const count=(bot,name)=>bot.inventory.items().filter(i=>i.name===name).reduce((n,i)=>n+i.count,0)
const inventory=bot=>bot.inventory.items().map(i=>({name:i.name,count:i.count}))
const save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2))
const consolePath=require('node:path').join(process.env.FORGE_TEST_DIR || require('node:path').resolve(__dirname,'../../../../forge-1201-test'),'console')
function command(text) {report.events.push({at:new Date().toISOString(),consoleCommand:text});fs.writeFileSync(consolePath,text+'\n')}
async function connect(name,role) {
 const bot=createBot(mineflayer,{host:'127.0.0.1',port:25586,username:name,version:'1.20.1',auth:'offline'}); bots.push(bot)
 configureClient(bot,detectProfile('1.20.1','forge'));bot.loadPlugin(pathfinder);loadPlugins(bot)
 if(role) bot.colonyController=new WorkerController({bot,name,role,homeProvider:()=>null,ownerProvider:()=>null})
 bot.on('error',err=>{report.events.push({name,error:err.message});save()})
 await new Promise((resolve,reject)=>{ const timer=setTimeout(()=>reject(new Error(name+' spawn timeout')),30000);bot.once('spawn',()=>{clearTimeout(timer);resolve()});bot.once('error',err=>{clearTimeout(timer);reject(err)}) })
 await bot.waitForChunksToLoad()
 if(!role){const moves=new Movements(bot);moves.canDig=false;moves.allow1by1towers=false;moves.scafoldingBlocks=[];bot.pathfinder.setMovements(moves)}
 return bot
}
async function fixture(main,bot,name,pos) {
 if(main.blockAt(pos)?.name!==name && (main.blockAt(pos)?.name!=='air' || main.blockAt(pos.offset(0,-1,0))?.boundingBox!=='block')) {
 let chosen
 report.fixtureScan=[]
 report.positions=bots.map(b=>({name:b.username,position:b.entity.position.clone()}))
 for (const dx of [0,1,2,3,4,5,6]) for (const dz of [0,2,-2]) for(const y of [63,64,65]) {
  const v=new Vec3(pos.x+dx,y,pos.z+dz)
  report.fixtureScan.push({v,feet:main.blockAt(v)?.name,head:main.blockAt(v.offset(0,1,0))?.name,floor:main.blockAt(v.offset(0,-1,0))?.name,box:main.blockAt(v.offset(0,-1,0))?.boundingBox})
  if(!chosen && ['air','snow'].includes(main.blockAt(v)?.name) && main.blockAt(v.offset(0,1,0))?.name==='air' && main.blockAt(v.offset(0,-1,0))?.boundingBox==='block' && bots.every(b=>b.entity.position.distanceTo(v.offset(.5,0,.5))>2))chosen=v
 }
 if(!chosen)throw new Error('No empty supported fixture position found')
 pos.x=chosen.x;pos.y=chosen.y;pos.z=chosen.z
} 
 if(main.blockAt(pos)?.name==='snow'){report.events.push({at:new Date().toISOString(),preparation:'clear one thin snow layer in survival',position:pos.clone()});await main.pathfinder.goto(new goals.GoalGetToBlock(pos.x,pos.y,pos.z));await main.dig(main.blockAt(pos));for(let i=0;i<20&&bot.blockAt(pos)?.name!=='air';i++)await sleep(100);if(bot.blockAt(pos)?.name!=='air')throw new Error('Snow clearing not confirmed by observer');}
 if(main.blockAt(pos)?.name!==name)command(`setblock ${pos.x} ${pos.y} ${pos.z} minecraft:${name} keep`);else report.events.push({reusedDeclaredFixture:pos.clone(),block:name})
 for(let i=0;i<30&&bot.blockAt(pos)?.name!==name;i++)await sleep(100)
 if(bot.blockAt(pos)?.name!==name)throw new Error('Fixture not confirmed')
 const original=bot.realFindBlocks || bot.findBlocks.bind(bot)
 bot.realFindBlocks=original
 bot.findBlocks=opts=>original({ ...opts, useExtraInfo: block => block.position.equals(pos) })
 return ()=>{bot.findBlocks=original}
}
async function task(bot,item,pos,hook,options={}) {
 if(bot.health<18 || bot.food<8)throw new Error('Safety stop: health or food too low for smoke')
 const record={discovery:bot.realFindBlocks ? {default:bot.realFindBlocks({matching:bot.registry.blocksByName[bot.blockAt(pos)?.name]?.id,count:4096,maxDistance:48}).some(p=>p.equals(pos)),full:bot.realFindBlocks({matching:bot.registry.blocksByName[bot.blockAt(pos)?.name]?.id,count:4096,maxDistance:48,useExtraInfo:true}).some(p=>p.equals(pos))}:null,worker:bot.username,targetBlock:bot.blockAt(pos)?.name,targetPosition:pos,expectedItem:item,expectedQuantity:1,inventoryBefore:count(bot,item),inventoryAllBefore:inventory(bot),startedAt:new Date().toISOString(),digEvents:[]}
 report.tasks.push(record); const original=bot.dig.bind(bot)
 bot.dig=async (...args)=>{record.digEvents.push({at:new Date().toISOString(),block:args[0]?.name,position:args[0]?.position,workerPosition:bot.entity.position.clone()});if(hook)await hook();const value=await original(...args);if(options.afterDig)await options.afterDig();return value}
 record.initialPosition=bot.entity.position.clone()
 const collected=[];const collect=(collector,entity)=>{if(collector?.id===bot.entity.id)collected.push({name:entity.getDroppedItem?.()?.name,count:entity.getDroppedItem?.()?.count,position:entity.position.clone()})};bot.on('playerCollect',collect)
 const began=performance.now()
 try{record.result=await bot.colonyController.run({type:'coletar_blocos',resource:options.resource || record.targetBlock,count:options.count || 1})}catch(err){record.error=err.message}
 finally{bot.removeListener('playerCollect',collect);record.pickupEvents=collected;record.finalPosition=bot.entity.position.clone();bot.dig=original;record.inventoryAfter=count(bot,item);record.delta=record.inventoryAfter-record.inventoryBefore;record.inventoryAllAfter=inventory(bot);record.blockFinal=bot.blockAt(pos)?.name;record.observerBlockFinal=bots[0].blockAt(pos)?.name;record.blockRemoved=record.blockFinal==='air';record.itemConfirmed=record.delta>=1;record.falsePositive=record.result?.ok===true&&!record.itemConfirmed;record.health=bot.health;record.food=bot.food;record.elapsedMs=performance.now()-began;save()}
 return record
}

const watchdog=setTimeout(()=>{report.failure='SESSION_TIMEOUT';save();bots.forEach(b=>b.quit());process.exit(1)},300000)
async function make(main,name,times=1,table=null) {
const recipes=main.recipesFor(main.registry.itemsByName[name].id,null,1,table);if(!recipes.length)throw new Error('No survival recipe '+name)
const before=count(main,name);await main.craft(recipes[0],times,table);report.events.push({craft:name,times,before,after:count(main,name)});
}
async function tool(main,miner,stock) {
if(count(miner,'wooden_pickaxe') || count(miner,'stone_pickaxe'))return
await stock.withdraw(main,'oak_log',2);await make(main,'oak_planks',2);await make(main,'stick');
let table=main.findBlock({matching:main.registry.blocksByName.crafting_table.id,maxDistance:32})
if(!table){await make(main,'crafting_table');
const pos=new Vec3(32,63,-8);if(main.blockAt(pos)?.name==='snow'){await main.pathfinder.goto(new goals.GoalGetToBlock(pos.x,pos.y,pos.z));await main.dig(main.blockAt(pos))}
if(main.blockAt(pos)?.name!=='air')throw new Error('Table placement occupied')
await main.pathfinder.goto(new goals.GoalGetToBlock(pos.x,pos.y,pos.z));await main.equip(main.inventory.items().find(i=>i.name==='crafting_table'),'hand');await main.placeBlock(main.blockAt(pos.offset(0,-1,0)),new Vec3(0,1,0));await sleep(300);table=main.blockAt(pos);if(table.name!=='crafting_table')throw new Error('Table not confirmed');report.events.push({placedSurvivalTable:pos})
}
await main.pathfinder.goto(new goals.GoalNear(table.position.x,table.position.y,table.position.z,2));await make(main,'wooden_pickaxe',1,table);
await stock.deposit(main,'wooden_pickaxe',1);await stock.withdraw(miner,'wooden_pickaxe',1);report.events.push({toolSupplied:'wooden_pickaxe',worker:miner.username,inventory:inventory(miner)})
}
async function park(bot,pos){await bot.pathfinder.goto(new goals.GoalNear(pos.x,pos.y,pos.z,1))}
;(async()=>{
try{
const main=await connect('eduardo_bot');const [wood,miner]=await Promise.all([connect('lenhador_01','lenhador'),connect('minerador_01','minerador')]);
const stock=new StorageManager();stock.setPosition(new Vec3(31,63,-6));report.stockBefore=await stock.summary(main);await tool(main,miner,stock);
report.workerInventoriesBefore=bots.map(b=>({worker:b.username,inventory:inventory(b)}));
for(let round=1;round<=3;round++){
await Promise.all([park(wood,new Vec3(30,63,0)),park(miner,new Vec3(30,63,-10))]);
const wp=new Vec3(42,63,2),mp=new Vec3(42,63,-8);
const rw=await fixture(main,wood,'oak_log',wp),rm=await fixture(main,miner,'stone',mp);
await park(main,new Vec3(30,63,-5));
const [w,m]=await Promise.all([task(wood,'oak_log',wp),task(miner,'cobblestone',mp)]);w.scenario=m.scenario='normal-concurrent';w.round=m.round=round;rw();rm();save();
}
report.resources=report.tasks.filter(t=>t.itemConfirmed).map(t=>({worker:t.worker,item:t.expectedItem,before:t.inventoryBefore,after:t.inventoryAfter,delta:t.delta}));
report.falsePositives=report.tasks.filter(t=>t.falsePositive).length;report.normalPasses=report.tasks.filter(t=>t.scenario==='normal-concurrent'&&t.result?.ok&&t.itemConfirmed).length;
report.ok=report.normalPasses===6&&report.falsePositives===0&&report.tasks.every(t=>t.observerBlockFinal==='air'&&t.pickupEvents.some(e=>e.name===t.expectedItem));
report.inventoryNearFull='not executed yet: no cheat-supplied inventory';
}catch(e){report.failure=e.stack;report.ok=false}
finally{const cpu=process.cpuUsage(cpuStart);report.processSample={wallMs:performance.now()-wallStart,cpuUserMs:cpu.user/1000,cpuSystemMs:cpu.system/1000,maxRssKiB:process.resourceUsage().maxRSS,scope:'short complete smoke process, not prolonged load test'};clearTimeout(watchdog);report.finishedAt=new Date().toISOString();save();bots.forEach(b=>{b.colonyController?.cancel();b.quit()});console.log(JSON.stringify({ok:report.ok,failure:report.failure,tasks:report.tasks.map(t=>({scenario:t.scenario,worker:t.worker,result:t.result,before:t.inventoryBefore,after:t.inventoryAfter,delta:t.delta}))},null,2));setTimeout(()=>process.exit(report.ok?0:1),1000)}
})()
