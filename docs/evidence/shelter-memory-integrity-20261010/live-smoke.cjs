const {createRequire}=require('module');const r=createRequire(process.env.MBOT_REPO+'/package.json');
const mineflayer=r('mineflayer'),{pathfinder,Movements}=r('mineflayer-pathfinder'),{Vec3}=r('vec3'),night=r('./lib/night'),fs=require('fs'),assert=require('assert/strict');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const server=require('child_process').spawn('java',['-Xms512M','-Xmx1536M','-jar','server.jar','nogui'],{cwd:'/tmp/mbot-mc1201',stdio:['pipe','pipe','pipe']});
server.stdout.on('data',d=>{fs.appendFileSync('/tmp/mbot-live-server.log',d);if(d.toString().includes('Done (')){server.stdin.write('gamerule doDaylightCycle false\ntime set day\nfill -6 66 -6 6 70 6 dirt\nfill -6 71 -6 6 75 6 air\nsetworldspawn 4 71 0\ngamerule spawnRadius 0\n');setTimeout(start,1000)}});server.stderr.on('data',d=>fs.appendFileSync('/tmp/mbot-live-server.log',d));
function start(){
const bot=mineflayer.createBot({host:'127.0.0.1',port:25575,username:'safety_smoke',version:'1.20.1',auth:'offline'});bot.loadPlugin(pathfinder);
async function wait(fn){for(let i=0;i<300;i++){if(fn())return;await sleep(100)}throw Error('phase timeout')}
let digs=0;
bot.once('spawn',async()=>{try{ const dig=bot.dig.bind(bot);bot.dig=async(...a)=>{digs++;return dig(...a)};
const m=new Movements(bot);m.canDig=false;m.allow1by1towers=true;m.allowParkour=false;bot.pathfinder.setMovements(m);
await wait(()=>bot.entity.position.y>70);await sleep(1500);
const ground=new Vec3(0,70,0);assert(night.safeToDig(bot,ground));
const goto=bot.pathfinder.goto.bind(bot.pathfinder);bot.pathfinder.goto=async(...a)=>{await goto(...a);server.stdin.write('setblock 1 69 0 lava\n');await wait(()=>bot.blockAt(new Vec3(1,69,0))?.name==='lava')};
await assert.rejects(night.digShelter(bot,ground,()=>false),/escavação insegura/);assert.equal(digs,0);assert.equal(bot.blockAt(ground).name,'dirt');console.log('PASS live terrain mutation: zero digs, ground preserved');
server.stdin.write('fill -6 66 -6 6 70 6 dirt\n');await wait(()=>bot.blockAt(new Vec3(1,69,0))?.name==='dirt');await sleep(1500);bot.pathfinder.goto=goto;
assert(night.safeToDig(bot,ground));const lid=await night.digShelter(bot,ground,()=>false);assert.equal(bot.blockAt(lid).name,'dirt');assert.equal(digs,3);console.log('PASS live safe shelter: 3 digs and lid confirmed');
const escaped=await night.leaveShelter(bot,lid,ground.offset(0,1,0));assert(escaped);console.log('PASS live exit: '+bot.entity.position);fs.writeFileSync('/tmp/mbot-live-phase','complete');
}catch(e){console.error(e);process.exitCode=1;}finally{bot.quit();server.stdin.write('stop\n');setTimeout(()=>process.exit(process.exitCode||0),3000)}});
bot.on('error',e=>{console.error(e);process.exit(1)});setTimeout(()=>{console.error('overall timeout');bot.quit();process.exit(1)},90000).unref();

}
