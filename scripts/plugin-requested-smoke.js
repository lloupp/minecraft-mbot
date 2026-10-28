'use strict'
// Diagnostics only: four plugins chosen by project owner. ONE plugin and ONE
// disposable local official Minecraft 1.20.1 server per invocation.
// No modifications to index.js, persistent world, or running server.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const mineflayer = require('mineflayer')
const { Vec3 } = require('vec3')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')

const candidate = process.argv[2]
const choices = ['statemachine', 'autoeat', 'movement', 'panorama']
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(check, timeout = 25000, label = 'condition') {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const value = await check()
    if (value) return value
    await sleep(100)
  }
  throw new Error('timeout: ' + label)
}
async function freePort() {
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function bounded(promise, timeout, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout: ' + label)), timeout) })
    ])
  } finally { clearTimeout(timer) }
}
async function main() {
  assert(choices.includes(candidate), 'usage: node scripts/plugin-requested-smoke.js <' + choices.join('|') + '>')
  assert.equal(process.env.MBOT_TEST_EULA_ACCEPTED, '1', 'explicit EULA acceptance required')
  const jar = path.resolve(process.env.MBOT_TEST_SERVER_JAR || '')
  await fs.access(jar)
  const evidenceDir = path.resolve(process.env.MBOT_PLUGIN_EVIDENCE_DIR || 'requested-plugin-evidence')
  await fs.mkdir(evidenceDir, { recursive:true })
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mbot-requested-plugin-'))
  const report = {
    plugin:candidate, version:'1.20.1', mode:'one bot, one ephemeral official vanilla server',
    status:'FAIL', checks:[], errors:[], restrictions:[
      'Does not enable plugin in minecraft-mbot runtime or Forge',
      'Not proof of multiworker concurrency or long-term stability'
    ]
  }
  function pass(name, evidence = {}) {
    report.checks.push({ name, status:'PASS', evidence })
    console.log('PASS', name, JSON.stringify(evidence))
  }
  let server=null, bot=null, serverLog='', shutdown=false
  function onError(err) { report.errors.push(err.message); console.error('BOT_ERROR',err.message) }
  async function command(text) {
    assert.equal(server.exitCode, null, 'server no longer active')
    server.stdin.write(text + '\n')
    await sleep(350)
  }
  async function give(item, count=1) {
    await command('give plugin_requested minecraft:' + item + ' ' + count)
    return waitFor(() => bot.inventory.items().find(i=>i.name===item),10000,'give '+item)
  }
  try {
    await fs.copyFile(jar, path.join(dir, 'server.jar'))
    await fs.writeFile(path.join(dir,'eula.txt'),'eula=true\n')
    const port=await freePort()
    await fs.writeFile(path.join(dir,'server.properties'),[
      'server-ip=127.0.0.1', 'server-port='+port, 'online-mode=false',
      'spawn-protection=0', 'difficulty=normal', 'gamemode=survival',
      'level-type=minecraft:flat','view-distance=4','simulation-distance=4',
      'max-players=2','enable-command-block=false','motd=plugin-requested-test'
    ].join('\n')+'\n')
    server=spawn('java',['-Xms256M','-Xmx1024M','-jar','server.jar','nogui'],{cwd:dir,stdio:['pipe','pipe','pipe']})
    for(const stream of [server.stdout,server.stderr]) stream.on('data',b=>{serverLog+=b.toString()})
    await waitFor(()=>serverLog.includes('Done ('),90000,'Minecraft startup')
    await command('gamerule doDaylightCycle false')
    await command('gamerule doMobSpawning false')
    await command('time set day')
    await command('fill -16 62 -16 16 62 16 stone')
    await command('fill -16 63 -16 16 75 16 air')
    await command('setworldspawn 0 63 0')
    bot=mineflayer.createBot({host:'127.0.0.1',port,version:'1.20.1',username:'plugin_requested',auth:'offline'})
    bot.on('error',onError)
    bot.on('end',reason=>{if(!shutdown)report.errors.push('disconnected: '+reason)})
    bot.loadPlugin(pathfinder)
    await waitFor(()=>bot.entity&&bot.registry&&bot.inventory,30000,'spawn')
    await bounded(bot.waitForChunksToLoad(),20000,'chunks')
    await command('tp plugin_requested 0 63 0')
    await waitFor(()=>bot.entity.position.distanceTo(new Vec3(0,63,0))<3,10000,'teleport')
    bot.pathfinder.setMovements(new Movements(bot))
    pass('connect', {pos:{x:bot.entity.position.x,y:bot.entity.position.y,z:bot.entity.position.z}})
    if(candidate==='statemachine') {
      // Existing opt-in adapter, real physical navigation and verified coordinates.
      const api=require('mineflayer-statemachine')
      assert.equal(typeof api.StateTransition,'function')
      assert.equal(typeof api.NestedStateMachine,'function')
      const { runExploreStateMachine }=require('../lib/stateMachineExplore')
      const dest={x:6,y:63,z:0}
      const res=await bounded(runExploreStateMachine({
        target:dest,
        move: async p=>bot.pathfinder.goto(new goals.GoalNear(p.x,p.y,p.z,1)),
        timeoutMs:19000,pollMs:50,logger:{log:msg=>console.log('FSM',msg)}
      }),22000,'statemachine physical navigation')
      assert.equal(res.ok,true,'FSM did not finish')
      const actual=bot.entity.position
      assert(actual.distanceTo(new Vec3(6,63,0))<=2.2,'FSM completion without arrival')
      pass('real_statemachine_move_verify',{res,position:actual})
      // Negative/cancel gate: adapter must classify cancelled without leaving ownership.
      const cancelled=await runExploreStateMachine({
        target:{x:12,y:63,z:0},move:async()=>new Promise(()=>{}),
        isCancelled:()=>true,timeoutMs:800,pollMs:5
      })
      assert.equal(cancelled.cancelled,true)
      pass('cancelled_transition',{cancelled})
      report.restrictions.push('Adapter cancellation is a state decision; pathfinder movement cancellation is owned by WorkerController, not proven here')
    } else if(candidate==='autoeat') {
      const auto=await import('mineflayer-auto-eat')
      assert.equal(typeof auto.loader,'function')
      bot.loadPlugin(auto.loader)
      assert(bot.autoEat,'autoEat missing')
      bot.autoEat.setOpts({minHunger:19,minHealth:14,returnToLastItem:true,bannedFood:['rotten_flesh','spider_eye','pufferfish','poisonous_potato','chorus_fruit']})
      await give('cooked_beef',8)
      const count=()=>bot.inventory.items().filter(i=>i.name==='cooked_beef').reduce((a,i)=>a+i.count,0)
      const before=count()
      const finished=[]
      const failed=[]
      bot.autoEat.on('eatFinish',opts=>finished.push(opts?.food?.name || 'unknown'))
      bot.autoEat.on('eatFail',e=>failed.push(String(e?.message||e)))
      bot.autoEat.enableAuto()
      // Hunger effect is an in-world stimulus, no direct mutation of bot.food.
      await command('effect give plugin_requested minecraft:hunger 20 255 true')
      await waitFor(()=>bot.food<=19,15000,'hunger decreased')
      const atHunger=bot.food
      const after=await waitFor(()=>count()<before && (finished.length || bot.food>atHunger) && count(),20000,'autoEat consumed actual cooked_beef')
      assert(failed.length===0,'autoEat failed: '+failed.join('; '))
      pass('real_auto_eat',{atHunger,before,after,food:bot.food,finishEvents:finished})
      bot.autoEat.disableAuto()
      assert.equal(bot.autoEat.enabled,false)
      pass('disable_auto',{enabled:bot.autoEat.enabled})
      report.restrictions.push('Auto enabled only in isolated test: must not compete with crafting/equipment or lib/food.js in production')
    } else if(candidate==='movement') {
      const movement=require('mineflayer-movement')
      assert.equal(typeof movement.plugin,'function')
      bot.loadPlugin(movement.plugin)
      const Default=bot.movement?.goals?.Default
      assert(Default,'default movement goal unavailable')
      bot.movement.setGoal(Default)
      const first=bot.entity.position.clone()
      const destination=new Vec3(7,63,0)
      bot.movement.heuristic.get('proximity').target(destination)
      let ticks=0
      const errors=[]
      const steer=()=>{
        if(ticks++>100) return
        try {
          const yaw=bot.movement.getYaw(180,15,1)
          if(!Number.isFinite(yaw))throw new Error('invalid yaw '+yaw)
          Promise.resolve(bot.movement.steer(yaw)).catch(err=>errors.push(err.message))
        }catch(err){errors.push(err.message)}
      }
      bot.on('physicsTick',steer)
      bot.setControlState('forward',true)
      try {
        await waitFor(()=>bot.entity.position.distanceTo(first)>=2.0,10000,'movement displacement')
        assert.deepEqual(errors,[],'movement steering errors')
        pass('real_movement_displacement',{start:first,end:bot.entity.position.clone(),distance:bot.entity.position.distanceTo(first),ticks})
      }finally{
        bot.setControlState('forward',false)
        bot.clearControlStates()
        bot.removeListener('physicsTick',steer)
      }
      assert.equal(bot.getControlState('forward'),false)
      pass('release_controls',{forward:false})
      report.restrictions.push('Movement plugin is short-range reactive steering only; never runs together with Pathfinder steering in production')
    } else if(candidate==='panorama') {
      // Native WebGL/canvas dependency often fails on modern Node; record actual
      // require/render failure as FAIL, never fake a successful panorama.
      const panorama=require('mineflayer-panorama')
      assert.equal(typeof panorama.panoramaImage,'function')
      bot.loadPlugin(panorama.panoramaImage)
      assert.equal(typeof bot.panoramaImage?.takePanoramaPictures,'function')
      pass('camera_interface_available')
      const stream=await bounded(bot.panoramaImage.takePanoramaPictures(),18000,'panorama renderer')
      assert(stream && typeof stream.pipe==='function','not an image stream')
      const image=path.join(dir,'panorama.jpeg')
      const destination=await fs.open(image,'w')
      try {
        await bounded(new Promise((resolve,reject)=>{
          const out=destination.createWriteStream()
          out.on('finish',resolve);out.on('error',reject);stream.on('error',reject)
          stream.pipe(out)
        }),16000,'panorama JPEG output')
      }finally{await destination.close().catch(()=>{})}
      const bytes=await fs.readFile(image)
      assert(bytes.length>1000 && bytes[0]===0xff && bytes[1]===0xd8, 'invalid JPEG stream')
      pass('render_real_panorama',{jpegBytes:bytes.length,jpegSignature:true})
      report.restrictions.push('Image output remains only in disposable test dir and is not deployed as a public service')
    }
    if(report.errors.length)throw new Error(report.errors.join('; '))
    pass('no_bot_errors')
    report.status='PASS'
  } catch(err) {
    report.error=String(err.stack||err)
    console.error('FAIL',candidate,report.error)
    process.exitCode=1
  } finally {
    shutdown=true
    if(bot){
      try{if(bot.autoEat?.enabled)bot.autoEat.disableAuto()}catch{}
      try{bot.clearControlStates()}catch{}
      try{bot.quit()}catch{}
    }
    await sleep(350)
    if(server?.exitCode===null) {
      try{const ended=once(server,'exit');server.stdin.write('stop\n');await bounded(ended,12000,'stop server')}
      catch {server.kill('SIGKILL')}
    }
    await fs.writeFile(path.join(evidenceDir,candidate+'.json'),JSON.stringify(report,null,2)+'\n')
    await fs.writeFile(path.join(evidenceDir,candidate+'-server.log'),serverLog)
    console.log('RESULT',JSON.stringify({plugin:candidate,status:report.status,checks:report.checks.map(c=>c.name),error:report.error?.split('\n')[0]}))
    await fs.rm(dir,{recursive:true,force:true})
  }
}
main().catch(err=>{console.error(err);process.exitCode=1})
