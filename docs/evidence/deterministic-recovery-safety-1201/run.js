// Test-only real-server harness. Hooks observe packets/inventory, never fake physical outcomes.
const fs = require('fs'), path = require('path'), { spawn } = require('child_process'), { once } = require('events')
const mineflayer = require('mineflayer'), { Vec3 } = require('vec3'), { pathfinder } = require('mineflayer-pathfinder')
const { WorkerController } = require('../../../core/WorkerController')
const { ProductionManager } = require('../../../core/ProductionManager')
const { JuliaShadowObserver } = require('../../../lib/julia-shadow')
const { realStateSnapshot } = require('../../../lib/real-state')
const { candidateIntents } = require('../../../lib/player-loop')
const gather = require('../../../lib/gather'), food = require('../../../lib/food')
const { preparationDispatchTask, preparationPlan } = require('../../../lib/forced-preparation')
const out = path.resolve(process.env.ORDER_OUTPUT_DIR), serverDir = process.env.ORDER_SERVER_DIR
fs.mkdirSync(out, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const rows = [], workers = [], pending = []
let server, sidecar, ready = false, scenario = 'startup', seq = 0
const capturedLines=[]
const record = (event,data={})=>{const line=JSON.stringify({seq:++seq,at:new Date().toISOString(),mono_ms:performance.now(),scenario,event,...data});capturedLines.push(line);fs.appendFileSync(path.join(out,'timeline.jsonl'),line+'\n')}
const inv = b => Object.fromEntries(b.inventory.items().map(i => i.name).map(n => [n, b.inventory.items().filter(i => i.name === n).reduce((s, i) => s + i.count, 0)]))
const state = w => realStateSnapshot(w.bot, { type: 'explorar' }, { homeProvider: w.homeProvider })
const until = async (fn, ms = 10000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw Error('HARNESS_SETUP_TIMEOUT'); await sleep(25) } }
const command = async c => { record('console', { command: c }); server.stdin.write(c + '\n'); await sleep(180) }
const shadow = new JuliaShadowObserver({ enabled: true, endpoint: 'http://127.0.0.1:8768/choose', eventLog: { log: (type, data) => record('shadow', { type, data }) } })
const originalMine = gather.mineBlocks
gather.mineBlocks = async (b, predicate, count, cancelled, options) => originalMine(b, predicate, count, cancelled, { ...options, onAttempt(a) { record('gather_attempt', { worker: b.username, taskVersion: b.worker.taskVersion, attempt: a }); options.onAttempt(a) } })
function instrument(w) {
  const b = w.bot; b.worker = w; let active = 0
  for (const name of ['dig', 'craft', 'equip', 'placeBlock']) {
    const original = b[name].bind(b)
    b[name] = async (...args) => {
      const version = w.taskVersion, item = args[0]?.name || args[0]?.result?.id || null
      record(name + '_start', { worker: w.name, taskVersion: version, session:w.session||0, item, target: args[0]?.position, active: ++active, connection:{ended:b._client.ended,writableEnded:b._client.serializer?.writableEnded,destroyed:b._client.socket?.destroyed}, phase:w.phase, authority:w.defending?'survival_reflex':w.currentTask?.type==='preparar_combate_deterministico'?'owned_preparation':'fixture', threat:state(w).threat, health:b.health, inventory: inv(b) })
      if (name === 'craft') b.craftWindow = true
      try { const operation = original(...args); if (w.operationHook) { const hook = w.operationHook; hook(name) } const result = await operation; record(name + '_end', { worker: w.name, taskVersion: version, currentVersion: w.taskVersion, health:b.health, inventory: inv(b) }); if(name==='dig' && w.afterDigHook){const hook=w.afterDigHook;w.afterDigHook=null;await hook()} return result }
      catch (error) { record(name + '_error', { worker: w.name, taskVersion: version, currentVersion: w.taskVersion, message: error.message, inventory: inv(b) }); throw error }
      finally { if (name === 'craft') b.craftWindow = false; active-- }
    }
  }
  for (const method of ['runDeterministicPreparation', 'goToPoint', 'defend']) {
    const original = w[method].bind(w)
    w[method] = async (...args) => { record('owned_task_entry', { worker:w.name, method, taskVersion:w.taskVersion, currentTask:w.currentTask }); if(method==='defend'){ const promise=original(...args); w.defensePromise=promise; const result=await promise; w.defenseEndedAt=performance.now();w.defenseEndSnapshot={offset_ms:0,taskVersion:w.taskVersion,state:state(w),heldItem:w.bot.heldItem?.name||null,candidates:candidateIntents(state(w)).map(c=>c.id),plan:preparationPlan(state(w)),resume:w.pendingPreparationResume(),position:{...w.bot.entity.position}};record('defense_end',{worker:w.name,result,...w.defenseEndSnapshot}); return result } return original(...args) }
  }
  let previousHealth = b.health
  b.on('health', () => { record('health', { worker:w.name, taskVersion:w.taskVersion, before:previousHealth, after:b.health, internalActive:w.internalActive, phase:w.phase, authority:w.defending?'survival_reflex':w.currentTask?.type==='preparar_combate_deterministico'?'owned_preparation':'fixture', threat:state(w).threat, inventory:inv(b) }); previousHealth = b.health })
  let previousThreat = false
  w.probe = setInterval(() => {
    const zombies = Object.values(b.entities).filter(e => e.name === 'zombie').map(e => ({ id:e.id, position:{...e.position}, distance:b.entity.position.distanceTo(e.position), velocity:e.velocity }))
    if (zombies.length || previousThreat) {
      const threat = state(w).threat
      record('perception', { worker:w.name, taskVersion:w.taskVersion, phase:w.phase, health:b.health, threat, zombies })
      if (threat && !previousThreat) record('first_threat_perception', { worker:w.name, taskVersion:w.taskVersion, phase:w.phase, threat, zombies })
      previousThreat = Boolean(threat)
    }
  }, 50)
  const internal = w.production.craftInternal.bind(w.production)
  w.production.craftInternal = async (...args) => {
    w.phase = 'craftInternal:' + args[1]
    record('craft_internal_entry', { worker:w.name, taskVersion:w.taskVersion, item:args[1], inventory:inv(b) })
    if (w.internalHook) { const hook = w.internalHook; w.internalHook = null; await hook(args[1]) }
    w.internalActive=true
    try {const result=await internal(...args);if(w.afterInternalHook){const hook=w.afterInternalHook;w.afterInternalHook=null;await hook()}return result} finally {w.internalActive=false;record('craft_internal_end',{worker:w.name,taskVersion:w.taskVersion,inventory:inv(b),health:b.health})}
  }
  const table = w.production.ensureCraftingTable.bind(w.production)
  w.production.ensureCraftingTable = async (...args) => {
    const result = await table(...args)
    if (w.tableHook) { const hook = w.tableHook; w.tableHook = null; await hook() }
    return result
  }
  const goto=b.pathfinder.goto.bind(b.pathfinder);b.pathfinder.goto=async goal=>{record('goto_start',{session:w.session||0,taskVersion:w.taskVersion,goal,position:{...b.entity.position},inventory:inv(b)});try{const operation=goto(goal);if(w.gotoHook){const hook=w.gotoHook;w.gotoHook=null;hook()}return await operation}finally{record('goto_end',{session:w.session||0,taskVersion:w.taskVersion,position:{...b.entity.position},inventory:inv(b)})}}
  const stop = b.pathfinder.stop.bind(b.pathfinder)
  b.pathfinder.stop = (...args) => { record('pathfinder_stop', { worker: w.name, taskVersion: w.taskVersion }); return stop(...args) }
  const write = b._client.write.bind(b._client)
  b._client.write = (name, packet) => {
    const returned = write(name, packet)
    if(name==='block_dig'){record('dig_packet',{session:w.session||0,taskVersion:w.taskVersion,packet,connection:{ended:b._client.ended,destroyed:b._client.socket?.destroyed}});if(w.digPacketHook)w.digPacketHook(packet)}
    if (name === 'window_click' && b.craftWindow && w.craftHook) { const hook = w.craftHook; w.craftHook = null; record('craft_packet_sent', { worker: w.name, taskVersion: w.taskVersion, packet }); hook() }
    return returned
  }
  b.inventory.on('updateSlot', () => {
    if (w.itemHook && (inv(b).cobblestone || 0) >= 1) { const hook = w.itemHook; w.itemHook = null; record('first_cobblestone_confirmed', { worker: w.name, taskVersion: w.taskVersion, inventory: inv(b) }); hook() }
  })
  b.on('end', reason=>record('session_end',{worker:w.name,session:w.session||0,taskVersion:w.taskVersion,reason,inventory:inv(b),currentTask:w.currentTask}));
  b.on('entitySpawn', e => { if (e.name === 'zombie') record('zombie_observed', { worker: w.name, taskVersion: w.taskVersion, distance: b.entity.position.distanceTo(e.position) }) })
}
const drops = b => Object.values(b.entities).filter(e=>e.name==='item' && e.isValid!==false).map(e=>({id:e.id,name:e.getDroppedItem?.()?.name||null,count:e.getDroppedItem?.()?.count||null,position:{...e.position}}))
const originalCollect=food.collectDrops
food.collectDrops=async(b,center,cancelled,options={})=>{
  const before=inv(b),matching=drops(b).filter(d=>new Vec3(d.position.x,d.position.y,d.position.z).distanceTo(center)<=options.radius && d.name==='cobblestone')
  record('recover_drop_entry',{session:b.worker.session,approvedTarget:{...center},inventory:before,drops:drops(b),matching})
  try {if(b.worker.recoveryHook){const hook=b.worker.recoveryHook;b.worker.recoveryHook=null;await hook()}return await originalCollect(b,center,cancelled,options)} finally {
    const after=inv(b),delta=(after.cobblestone||0)-(before.cobblestone||0)
    record('recover_drop_end',{session:b.worker.session,task:'recover_drop',approvedTarget:{...center},inventoryBefore:before,inventoryAfter:after,delta,inventoryConfirmed:delta>0})
  }
}
async function run(w, task) {
  record('task_requested', { worker: w.name, previousVersion: w.taskVersion, task, inventory: inv(w.bot) })
  const result = await w.run(task)
  record('task_returned', { worker: w.name, taskVersion: w.taskVersion, result, inventory: inv(w.bot), currentTask: w.currentTask })
  return result
}
const prep = (targets = []) => ({ type: 'preparar_combate_deterministico', objective: { type: 'explorar' }, allowedTargets: targets, timeoutMs: 16000 })
function replace(w) { return run(w, { type: 'ir_local', position: { ...w.bot.entity.position } }) }
async function setup(w, route = 'stone', blocked = false) {
  w.cancel(); w.itemHook = null; w.craftHook = null; w.internalHook = null; w.operationHook = null; w.tableHook = null; w.phase = 'fixture'
  await command('difficulty peaceful'); await command('time set day'); await command('kill @e[type=!minecraft:player]')
  const x = w.name === 'prep_A' ? 0 : 12
  await command(`clear ${w.name}`)
  await command(`fill ${x - 26} 199 -26 ${x + 26} 199 26 minecraft:dirt`)
  await command(`fill ${x - 26} 200 -26 ${x + 26} 204 26 minecraft:air`)
  await command(`tp ${w.name} ${x + .5} 200 0.5`)
  await command(`effect give ${w.name} minecraft:saturation 1 255 true`); await command(`effect give ${w.name} minecraft:instant_health 1 5 true`); await sleep(1100)
  await command(`effect clear ${w.name}`)
  const targets = []
  if (route === 'stone') {
    await command(`give ${w.name} minecraft:stick 1`); await command(`give ${w.name} minecraft:stone_pickaxe 1`)
    for (const [dx, z] of [[0, 2], [2, 0]]) { await command(`setblock ${x + dx} 200 ${z} minecraft:stone`); targets.push({ x: x + dx, y: 200, z, name: 'stone' }) }
    await w.bot.equip(w.bot.inventory.items().find(i => i.name === 'stone_pickaxe'), 'hand')
  } else {
    await command(`give ${w.name} minecraft:cobblestone 2`)
    await command(`give ${w.name} minecraft:${route === 'sword' ? 'stick' : 'oak_log'} 1`)
  }
  const table = new Vec3(x + (blocked ? 1 : -1), 200, blocked ? 1 : (process.env.SCENARIOS === 'handoff' ? 1 : -1))
  await command(`setblock ${table.x} 200 ${table.z} minecraft:crafting_table`)
  await sleep(250); w.production.rememberCraftingTable(w.bot, w.bot.blockAt(table))
  record('initial_state', { worker: w.name, taskVersion: w.taskVersion, state: state(w), targets, table })
  return targets
}
function dispatch(w, targets = []) {
  const snapshot = state(w)
  for (const t of targets) {
    const pos = new Vec3(t.x,t.y,t.z)
    if (w.bot.entity.position.distanceTo(pos) <= 4 && w.bot.blockAt(pos)?.name === t.name) {
      if (['stone','cobblestone'].includes(t.name)) snapshot.nearby.stone = true
      if (t.name.endsWith('_log')) snapshot.nearby.wood = true
    }
  }
  const task = preparationDispatchTask({ enabled:true, state:snapshot, objective:{type:'explorar'}, allowedTargets:targets, timeoutMs:14000 })
  record('dispatch_reassessment', { worker:w.name, taskVersion:w.taskVersion, state:snapshot, plan:preparationPlan(snapshot), task })
  return task
}
async function resume(w, targets) {
  const results = []
  for (let n=0;n<3;n++) {
    const task = dispatch(w, targets)
    if (!task) break
    w.phase = 'resume:' + task.deterministicIntent
    const result = await run(w,task); results.push(result)
    if (!result.ok) break
  }
  return { results, inventory:inv(w.bot), held:w.bot.heldItem?.name || null, candidates:candidateIntents(state(w)).map(c=>c.id) }
}
async function cleanThreat(w) {
  await command('kill @e[type=minecraft:zombie]'); await command('difficulty peaceful'); await command(`effect clear ${w.name}`)
  await until(()=>!state(w).threat)
  w.cancel(); await until(()=>!w.defending); await sleep(200)
}
function summon(w, distance=1, moving=false, speed=null) {
  const p = w.bot.entity.position
  const value = `summon minecraft:zombie ${p.x+distance} 200 ${p.z} {PersistenceRequired:1b,Silent:1b,Tags:["cycle_threat"],CanPickUpLoot:0b,ArmorItems:[{},{},{},{id:"minecraft:iron_helmet",Count:1b}],Attributes:[{Name:"generic.follow_range",Base:48.0},{Name:"generic.knockback_resistance",Base:1.0},{Name:"generic.movement_speed",Base:${speed ?? (moving ? '0.35' : '0.23')}}]}`
  record('zombie_summon_requested',{ position:{x:p.x+distance,y:200,z:p.z}, distance, aiEnabled:true, phase:w.phase, command:value }); server.stdin.write(value+'\n')
}
async function perform(name, fn) {
  scenario = name; const started = Date.now(); record('scenario_start')
  try { const result = await fn(); rows.push({ scenario: name, elapsed_ms: Date.now() - started, ...result }); console.log(name, JSON.stringify(result.summary || result.resume?.candidates || result.code || 'done')) }
  catch (error) { rows.push({ scenario: name, elapsed_ms: Date.now() - started, harnessError: error.stack }); record('scenario_error', { error: error.stack }); console.log(name, 'FAILED', error.message) }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(rows, null, 2)); record('scenario_end')
}
async function main() {
  const crypto=require('crypto'),files=['lib/forced-preparation.js','lib/gather.js','core/ProductionManager.js','core/WorkerController.js','lib/food.js']
  fs.writeFileSync(path.join(out,'source-sha256.json'),JSON.stringify(Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../../..',f))).digest('hex')])),null,2))
  fs.copyFileSync(__filename,path.join(out,'harness-source.txt'))

  fs.writeFileSync(path.join(serverDir, 'server.properties'), ['server-ip=127.0.0.1','server-port=25566','online-mode=false','enforce-secure-profile=false','level-name=recovery-safety-world','level-type=minecraft:flat','generate-structures=false','difficulty=peaceful','view-distance=3','simulation-distance=3','spawn-protection=0','allow-flight=true','max-players=3'].join('\n'))
  async function startServer() {
    ready=false;server=spawn('java',['-Xms256M','-Xmx1024M','-jar','server.jar','nogui'],{cwd:serverDir})
    const log=fs.createWriteStream(path.join(out,'minecraft.log'),{flags:'a'})
    server.stdout.on('data',d=>{log.write(d);if(d.toString().includes('Done ('))ready=true});server.stderr.pipe(log,{end:false})
    await until(()=>ready,90000);record('server_started',{pid:server.pid})
  }
  await startServer()
  for (const c of ['gamerule doDaylightCycle false','time set day','gamerule doMobSpawning false','gamerule randomTickSpeed 0','gamerule naturalRegeneration false']) await command(c)
  sidecar = spawn(process.env.ORDER_PYTHON, [path.join(__dirname, 'capture_sidecar.py')], { env: { ...process.env, JULIA_DEVICE:'cpu', OMP_NUM_THREADS:'2', MKL_NUM_THREADS:'2', HF_HUB_OFFLINE:'1', HF_HUB_DISABLE_TELEMETRY:'1', USE_TF:'0' } })
  const juliaLog = fs.createWriteStream(path.join(out, 'sidecar.log')); sidecar.stdout.pipe(juliaLog); sidecar.stderr.pipe(juliaLog, { end: false })
  let healthy = false
  await until(() => healthy, 1).catch(() => {})
  const started = Date.now()
  while (!healthy) { try { healthy = (await (await fetch('http://127.0.0.1:8768/healthz')).json()).ok } catch {} if (Date.now() - started > 90000) throw Error('SIDECAR_START_TIMEOUT'); await sleep(100) }
  async function connect(name, session=0) {
    const b = mineflayer.createBot({ host:'127.0.0.1', port:25566, username:name, version:'1.20.1', auth:'offline' }); b.loadPlugin(pathfinder)
    const w = new WorkerController({ bot:b, name, role:'worker', homeProvider: () => new Vec3(100, 200, 0), ownerProvider: () => null, production:new ProductionManager({ storage:null }), shadow, logger:{ log: message => record('worker_log', { worker:name, message }) } })
    w.session=session;workers.push(w); b.on('error', e => record('bot_error', { worker:name, message:e.message })); await once(b, 'spawn'); await b.waitForChunksToLoad(); instrument(w)
    const table=b.blockAt(new Vec3(-1,200,-1));if(table?.name==='crafting_table')w.production.rememberCraftingTable(b,table)
    record('session_spawn',{worker:name,session,taskVersion:w.taskVersion,inventory:inv(b),state:state(w),position:{...b.entity.position}})
    return w
  }
  await connect('prep_A')
  let current=workers[0]
  const selected=(process.env.SCENARIOS||'threat,new_order,replacement').split(',')
  async function disconnectBeforePickup(w,transport) {
    await until(()=>w.bot.blockAt(new Vec3(0,200,2))?.name==='air' && drops(w.bot).some(d=>d.name==='cobblestone'))
    record('air_and_drop_before_disconnect',{session:w.session,inventory:inv(w.bot),drops:drops(w.bot),target:w.bot.blockAt(new Vec3(0,200,2))?.name,position:{...w.bot.entity.position}})
    if((inv(w.bot).cobblestone||0)!==0)throw Error('FIXTURE_PICKUP_ALREADY_CONFIRMED')
    record('disconnect_requested',{session:w.session,taskVersion:w.taskVersion,transport,inventory:inv(w.bot)})
    if(transport==='socket_destroy')w.bot._client.socket.destroy()
    else w.bot.quit('drop recovery smoke')
  }
  for(const mode of selected) await perform(mode,async()=>{
    const old=current,targets=await setup(old),original=prep(targets)
    const ended=new Promise(resolve=>old.bot.once('end',resolve))
    if(mode==='abrupt_dig'||mode==='server_crash') {
      await command(`effect give ${old.name} minecraft:mining_fatigue 10 0 true`)
      if(mode==='server_crash'){await command('save-all flush');await sleep(250)}
      old.digPacketHook=packet=>{if(packet.status===0){old.digPacketHook=null;record('transport_cut_scheduled_after_start_packet',{session:old.session,packet,delay_ms:100});setTimeout(()=>{record('disconnect_requested',{session:old.session,taskVersion:old.taskVersion,transport:mode,inventory:inv(old.bot),drops:drops(old.bot),target:old.bot.blockAt(new Vec3(0,200,2))?.name,digInFlight:!!old.bot.targetDigBlock,bytesWritten:old.bot._client.socket.bytesWritten});if(mode==='server_crash')server.kill('SIGKILL');else old.bot._client.socket.destroy()},100)}}
    } else old.afterDigHook=()=>disconnectBeforePickup(old,mode==='abrupt_pickup'?'socket_destroy':'quit')
    const pending=run(old,original);await ended;clearInterval(old.probe)
    const settled=await Promise.race([pending,sleep(5000).then(()=>({harnessPending:true}))])
    const oldVersion=old.taskVersion
    if(mode==='server_crash'){await sleep(250);await startServer()}
    current=await connect(old.name,(old.session||0)+1)
    const beforeMutation={inventory:inv(current.bot),state:state(current),plan:preparationPlan(state(current)),drops:drops(current.bot),targets:targets.map(t=>({...t,actual:current.bot.blockAt(new Vec3(t.x,t.y,t.z))?.name}))}
    record('reconnect_observed',{session:current.session,...beforeMutation,oldVersion,oldTask:old.currentTask,settled})
    await command(`tp ${current.name} .5 200 -1.5`)
    await until(()=>current.bot.entity.position.z < -1.3)
    if((inv(current.bot).cobblestone||0)!==0)throw Error('FIXTURE_PICKUP_ALREADY_CONFIRMED')
    let intervention=null
    current.phase='recovery_movement'
    current.gotoHook=()=>{
      record('intervention_requested',{mode,session:current.session,taskVersion:current.taskVersion,inventory:inv(current.bot),drops:drops(current.bot),position:{...current.bot.entity.position}})
      if(mode==='new_order')intervention=replace(current)
      if(mode==='threat')intervention=(async()=>{await command('difficulty normal');summon(current,6,true);await until(()=>state(current).threat);record('threat_confirmed',{state:state(current),inventory:inv(current.bot)})})()
      if(mode==='replacement')intervention=(async()=>{
        await command('kill @e[type=minecraft:item]')
        await command('summon minecraft:item .5 200.2 2.5 {Item:{id:"minecraft:cobblestone",Count:1b},Motion:[0.0d,0.0d,0.0d]}')
        record('replacement_observed',{drops:drops(current.bot),inventory:inv(current.bot)})
      })()
    }
    const before={inventory:inv(current.bot),plan:preparationPlan(state(current)),drops:drops(current.bot),state:state(current)}
    record('recovery_fixture_ready',{session:current.session,mode,...before,targets})
    const result=await run(current,original)
    if(intervention)await intervention
    let final=null
    if(mode==='threat')await cleanThreat(current)
    if(mode==='threat'||mode==='new_order')final=await resume(current,targets)
    const after={inventory:inv(current.bot),plan:preparationPlan(state(current)),drops:drops(current.bot),state:state(current),held:current.bot.heldItem?.name||null}
    record('recovery_final',{session:current.session,mode,...after,oldVersionFinal:old.taskVersion,oldTask:old.currentTask})
    return {mode,oldSession:old.session,newSession:current.session,oldVersion,oldVersionFinal:old.taskVersion,oldTask:old.currentTask,settled,beforeMutation,before,result,final,after,summary:{code:result.code||'OK',steps:result.steps?.map(s=>({task:s.task,delta:s.delta,requested:s.requested,inventoryConfirmed:s.inventoryConfirmed})),before:before.inventory,after:after.inventory,remaining:after.plan.collect.cobblestone,held:after.held,oldPending:!!settled.harnessPending}}
  })
  await sleep(2500)
  fs.writeFileSync(path.join(out,'metadata.json'),JSON.stringify({ optIn:process.env.MBOT_DETERMINISTIC_PREPARATION, juliaShadow:true, juliaExecutionAuthority:'none', minecraft:'1.20.1', revision:process.env.TEST_REVISION, selected },null,2))
}
main().catch(e => { record('fatal',{ error:e.stack }); console.error(e); process.exitCode=1 }).finally(async () => { for (const w of workers) { clearInterval(w.probe); w.cancel(); w.bot.quit() } sidecar?.kill(); if(server && server.exitCode===null && server.signalCode===null)server.stdin.write('stop\n'); await sleep(1500); server?.kill();const rows=fs.readFileSync(path.join(out,'timeline.jsonl'),'utf8').trim().split('\n').map(JSON.parse),seen=new Set(rows.map(r=>r.seq)),missing=Array.from({length:seq},(_,i)=>i+1).filter(n=>!seen.has(n));fs.copyFileSync(path.join(out,'timeline.jsonl'),path.join(out,'timeline-append.jsonl'));const buffered=capturedLines.map(JSON.parse),bufferedSeen=new Set(buffered.map(r=>r.seq)),bufferMissing=Array.from({length:seq},(_,i)=>i+1).filter(n=>!bufferedSeen.has(n));record('recorder_integrity',{appendMissing:missing,bufferMissing});fs.writeFileSync(path.join(out,'timeline.jsonl'),capturedLines.join('\n')+'\n');if(bufferMissing.length)process.exitCode=1 })
