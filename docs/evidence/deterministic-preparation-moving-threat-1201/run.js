// Test-only real-server harness. Hooks observe packets/inventory, never fake physical outcomes.
const fs = require('fs'), path = require('path'), { spawn } = require('child_process'), { once } = require('events')
const mineflayer = require('mineflayer'), { Vec3 } = require('vec3'), { pathfinder } = require('mineflayer-pathfinder')
const { WorkerController } = require('../../../core/WorkerController')
const { ProductionManager } = require('../../../core/ProductionManager')
const { JuliaShadowObserver } = require('../../../lib/julia-shadow')
const { realStateSnapshot } = require('../../../lib/real-state')
const { candidateIntents } = require('../../../lib/player-loop')
const gather = require('../../../lib/gather')
const { preparationDispatchTask, preparationPlan } = require('../../../lib/forced-preparation')
const out = path.resolve(process.env.ORDER_OUTPUT_DIR), serverDir = process.env.ORDER_SERVER_DIR
fs.mkdirSync(out, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const rows = [], workers = [], pending = []
let server, sidecar, ready = false, scenario = 'startup', seq = 0
const record = (event, data = {}) => fs.appendFileSync(path.join(out, 'timeline.jsonl'), JSON.stringify({ seq: ++seq, at: new Date().toISOString(), mono_ms:performance.now(), scenario, event, ...data }) + '\n')
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
      record(name + '_start', { worker: w.name, taskVersion: version, item, target: args[0]?.position, active: ++active, phase:w.phase, authority:w.defending?'survival_reflex':w.currentTask?.type==='preparar_combate_deterministico'?'owned_preparation':'fixture', threat:state(w).threat, health:b.health, inventory: inv(b) })
      if (name === 'craft') b.craftWindow = true
      try { const operation = original(...args); if (w.operationHook) { const hook = w.operationHook; hook(name) } const result = await operation; record(name + '_end', { worker: w.name, taskVersion: version, currentVersion: w.taskVersion, health:b.health, inventory: inv(b) }); return result }
      catch (error) { record(name + '_error', { worker: w.name, taskVersion: version, currentVersion: w.taskVersion, message: error.message, inventory: inv(b) }); throw error }
      finally { if (name === 'craft') b.craftWindow = false; active-- }
    }
  }
  for (const method of ['runDeterministicPreparation', 'goToPoint', 'defend']) {
    const original = w[method].bind(w)
    w[method] = async (...args) => { record('owned_task_entry', { worker:w.name, method, taskVersion:w.taskVersion, currentTask:w.currentTask }); return original(...args) }
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
    try {return await internal(...args)} finally {w.internalActive=false;record('craft_internal_end',{worker:w.name,taskVersion:w.taskVersion,inventory:inv(b),health:b.health})}
  }
  const table = w.production.ensureCraftingTable.bind(w.production)
  w.production.ensureCraftingTable = async (...args) => {
    const result = await table(...args)
    if (w.tableHook) { const hook = w.tableHook; w.tableHook = null; await hook() }
    return result
  }
  const stop = b.pathfinder.stop.bind(b.pathfinder)
  b.pathfinder.stop = (...args) => { record('pathfinder_stop', { worker: w.name, taskVersion: w.taskVersion }); return stop(...args) }
  const write = b._client.write.bind(b._client)
  b._client.write = (name, packet) => {
    const returned = write(name, packet)
    if (name === 'window_click' && b.craftWindow && w.craftHook) { const hook = w.craftHook; w.craftHook = null; record('craft_packet_sent', { worker: w.name, taskVersion: w.taskVersion, packet }); hook() }
    return returned
  }
  b.inventory.on('updateSlot', () => {
    if (w.itemHook && (inv(b).cobblestone || 0) >= 1) { const hook = w.itemHook; w.itemHook = null; record('first_cobblestone_confirmed', { worker: w.name, taskVersion: w.taskVersion, inventory: inv(b) }); hook() }
  })
  b.on('entitySpawn', e => { if (e.name === 'zombie') record('zombie_observed', { worker: w.name, taskVersion: w.taskVersion, distance: b.entity.position.distanceTo(e.position) }) })
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
  const table = new Vec3(x + (blocked ? 1 : -1), 200, blocked ? 1 : -1)
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
  const value = `summon minecraft:zombie ${p.x+distance} 200 ${p.z} {PersistenceRequired:1b,Silent:1b,Tags:["cycle_threat"],CanPickUpLoot:0b,ArmorItems:[{},{},{},{id:"minecraft:iron_helmet",Count:1b}],Attributes:[{Name:"generic.follow_range",Base:48.0},{Name:"generic.movement_speed",Base:${speed ?? (moving ? '0.35' : '0.23')}}]}`
  record('zombie_summon_requested',{ position:{x:p.x+distance,y:200,z:p.z}, distance, aiEnabled:true, phase:w.phase, command:value }); server.stdin.write(value+'\n')
}
async function perform(name, fn) {
  scenario = name; const started = Date.now(); record('scenario_start')
  try { const result = await fn(); rows.push({ scenario: name, elapsed_ms: Date.now() - started, ...result }); console.log(name, JSON.stringify(result.summary || result.resume?.candidates || result.code || 'done')) }
  catch (error) { rows.push({ scenario: name, elapsed_ms: Date.now() - started, harnessError: error.stack }); record('scenario_error', { error: error.stack }); console.log(name, 'FAILED', error.message) }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(rows, null, 2)); record('scenario_end')
}
async function main() {
  const crypto=require('crypto'),files=['lib/forced-preparation.js','lib/gather.js','core/ProductionManager.js','core/WorkerController.js']
  fs.writeFileSync(path.join(out,'source-sha256.json'),JSON.stringify(Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../../..',f))).digest('hex')])),null,2))
  fs.copyFileSync(__filename,path.join(out,'harness-source.txt'))

  fs.writeFileSync(path.join(serverDir, 'server.properties'), ['server-ip=127.0.0.1','server-port=25566','online-mode=false','enforce-secure-profile=false','level-name=moving-threat-world','level-type=minecraft:flat','generate-structures=false','difficulty=peaceful','view-distance=3','simulation-distance=3','spawn-protection=0','allow-flight=true','max-players=3'].join('\n'))
  server = spawn('java', ['-Xms256M','-Xmx1024M','-jar','server.jar','nogui'], { cwd: serverDir })
  const log = fs.createWriteStream(path.join(out, 'minecraft.log'))
  server.stdout.on('data', d => { log.write(d); if (d.toString().includes('Done (')) ready = true }); server.stderr.pipe(log, { end: false })
  await until(() => ready, 90000)
  for (const c of ['gamerule doDaylightCycle false','time set day','gamerule doMobSpawning false','gamerule randomTickSpeed 0','gamerule naturalRegeneration false']) await command(c)
  sidecar = spawn(process.env.ORDER_PYTHON, [path.join(__dirname, 'capture_sidecar.py')], { env: { ...process.env, JULIA_DEVICE:'cpu', OMP_NUM_THREADS:'2', MKL_NUM_THREADS:'2', HF_HUB_OFFLINE:'1', HF_HUB_DISABLE_TELEMETRY:'1', USE_TF:'0' } })
  const juliaLog = fs.createWriteStream(path.join(out, 'sidecar.log')); sidecar.stdout.pipe(juliaLog); sidecar.stderr.pipe(juliaLog, { end: false })
  let healthy = false
  await until(() => healthy, 1).catch(() => {})
  const started = Date.now()
  while (!healthy) { try { healthy = (await (await fetch('http://127.0.0.1:8768/healthz')).json()).ok } catch {} if (Date.now() - started > 90000) throw Error('SIDECAR_START_TIMEOUT'); await sleep(100) }
  for (const name of ['prep_A']) {
    const b = mineflayer.createBot({ host:'127.0.0.1', port:25566, username:name, version:'1.20.1', auth:'offline' }); b.loadPlugin(pathfinder)
    const w = new WorkerController({ bot:b, name, role:'worker', homeProvider: () => new Vec3(100, 200, 0), ownerProvider: () => null, production:new ProductionManager({ storage:null }), shadow, logger:{ log: message => record('worker_log', { worker:name, message }) } })
    workers.push(w); b.on('error', e => record('bot_error', { worker:name, message:e.message })); await once(b, 'spawn'); await b.waitForChunksToLoad(); instrument(w)
  }
  const [a] = workers, selected=(process.env.SCENARIOS || 'policy,moving,attack_gather,attack_craft,race,table,inventory').split(',')
  if (selected.includes('policy')) await perform('policy',async()=>{
    const targets=await setup(a), base=state(a), tests=[]
    const evaluate=(name,s,allow,expected)=>{ const task=preparationDispatchTask({enabled:true,state:s,objective:{type:'explorar'},allowedTargets:allow}); tests.push({name,state:s,allowedTargets:allow,task,expected,passed:Boolean(task)===expected}) }
    evaluate('gather_with_allowlist',base,targets,true); evaluate('gather_without_allowlist',base,[],false)
    await command('difficulty normal'); summon(a,3); await until(()=>state(a).threat)
    evaluate('real_threat',state(a),targets,false); await cleanThreat(a)
    await command('summon minecraft:cow -2.5 200 0.5 {NoAI:1b,Silent:1b}'); await command('difficulty normal'); await command(`effect give ${a.name} minecraft:hunger 10 255 true`); await until(()=>a.bot.food<=5); await command(`effect clear ${a.name}`)
    evaluate('critical_food',state(a),targets,false)
    await setup(a); evaluate('cancelled_snapshot',{...base,cancellationRequested:true},targets,false)
    await setup(a,'sword'); evaluate('prepare_combat',state(a),[],true)
    await command(`give ${a.name} minecraft:stone_sword 1`); await until(()=>inv(a.bot).stone_sword===1)
    evaluate('equip_existing_stone_sword',state(a),[],true); await a.bot.equip(a.bot.inventory.items().find(i=>i.name==='stone_sword'),'hand'); evaluate('armed',state(a),targets,false)
    return {tests,summary:{passed:tests.filter(t=>t.passed).length,total:tests.length}}
  })
  if (selected.includes('moving')) await perform('moving',async()=>{
    const targets=await setup(a); await command('difficulty normal')
    a.itemHook=()=>{ a.phase='partial_pickup'; server.stdin.write(`effect give ${a.name} minecraft:mining_fatigue 10 0 true\n`); summon(a,18,true) }
    a.phase='gather'; const interrupted=await run(a,dispatch(a,targets)), partial=inv(a.bot)
    await cleanThreat(a); const resumed=await resume(a,targets.filter(t=>a.bot.blockAt(new Vec3(t.x,t.y,t.z))?.name===t.name))
    return {interrupted,partial,resume:resumed,summary:{code:interrupted.code||'OK',partial,final:resumed.held}}
  })
  async function primeAttack(w) {
    summon(w,18,false,0);await until(()=>Object.values(w.bot.entities).some(e=>e.name==='zombie'));await sleep(1600)
    record('attack_ai_primed_outside_radius',{threat:state(w).threat,zombies:Object.values(w.bot.entities).filter(e=>e.name==='zombie').map(e=>({position:{...e.position},distance:e.position.distanceTo(w.bot.entity.position)}))})
  }
  function contact(w){const p=w.bot.entity.position;w.phase='primed_zombie_contact';const c=`tp @e[type=minecraft:zombie,tag=cycle_threat,limit=1] ${p.x+.6} 200 ${p.z}`;record('contact_requested',{command:c});server.stdin.write(c+'\n')}
  if (selected.includes('attack_gather')) await perform('attack_gather',async()=>{
    const targets=await setup(a); await command('difficulty normal'); await command(`effect give ${a.name} minecraft:mining_fatigue 15 0 true`)
    await primeAttack(a)
    let digs=0; a.operationHook=name=>{ if(name==='dig' && ++digs===2) { a.phase='second_dig_in_flight'; contact(a) } }
    const health=a.bot.health, interrupted=await run(a,dispatch(a,targets)); await until(()=>a.bot.health<health,2500).catch(()=>{})
    const after=a.bot.health, partial=inv(a.bot); await cleanThreat(a)
    const resumed=await resume(a,targets.filter(t=>a.bot.blockAt(new Vec3(t.x,t.y,t.z))?.name===t.name))
    return {interrupted,healthBefore:health,healthAfter:after,partialDuringDefense:typeof partialDuringDefense==='undefined'?null:partialDuringDefense,partial,resume:resumed,summary:{code:interrupted.code||'OK',healthBefore:health,healthAfter:after,partial,final:resumed.held}}
  })
  if (selected.includes('attack_craft')) await perform('attack_craft',async()=>{
    await setup(a,'sword'); await command('tp prep_A 2.5 200 0.5'); await until(()=>a.bot.entity.position.x>2); await a.bot.lookAt(new Vec3(30,201,0),true); await command('difficulty normal')
    record('craft_attack_initial_orientation',{position:{...a.bot.entity.position},yaw:a.bot.entity.yaw,tableDistance:a.bot.entity.position.distanceTo(new Vec3(-1,200,-1))})
    await primeAttack(a)
    a.operationHook=name=>{if(name==='craft'){a.operationHook=null;contact(a)}}
    const health=a.bot.health, interrupted=await run(a,dispatch(a,[])); await until(()=>a.bot.health<health,2500).catch(()=>{})
    const after=a.bot.health,partialDuringDefense=inv(a.bot); await cleanThreat(a); const partial=inv(a.bot), resumed=await resume(a,[])
    return {interrupted,healthBefore:health,healthAfter:after,partialDuringDefense:typeof partialDuringDefense==='undefined'?null:partialDuringDefense,partial,resume:resumed,summary:{code:interrupted.code||'OK',healthBefore:health,healthAfter:after,partial,final:resumed.held}}
  })
  if (selected.includes('race')) await perform('safety_craft_race',async()=>{
    await setup(a,'sword'); await command('difficulty normal')
    // Scheduling probe at a real await boundary: no fake model/state/physical output.
    a.tableHook=async()=>{ a.phase='table_validated_after_safety'; summon(a,3); await until(()=>state(a).threat); record('race_gate_observed_threat',{threat:state(a).threat}) }
    const interrupted=await run(a,dispatch(a,[])),partial=inv(a.bot); await cleanThreat(a); const resumed=await resume(a,[])
    return {interrupted,partial,resume:resumed,summary:{code:interrupted.code||'OK',partial,final:resumed.held}}
  })
  if (selected.includes('table')) await perform('table_removed',async()=>{
    const targets=await setup(a),gathered=await run(a,dispatch(a,targets)); await command(`give ${a.name} minecraft:oak_planks 4`)
    // Remove after executor table preflight but before ProductionManager's own table lookup.
    a.internalHook=async()=>{ await command('setblock -1 200 -1 minecraft:air'); await until(()=>a.bot.blockAt(new Vec3(-1,200,-1))?.name==='air'); record('table_removal_confirmed') }
    const failed=await run(a,dispatch(a,[])),partial=inv(a.bot)
    await command('setblock -1 200 -1 minecraft:crafting_table'); await sleep(150); a.production.rememberCraftingTable(a.bot,a.bot.blockAt(new Vec3(-1,200,-1)))
    const resumed=await resume(a,[]);return {gathered,failed,partial,resume:resumed,summary:{code:failed.code||'OK',partial,final:resumed.held}}
  })
  if (selected.includes('inventory')) for(const mutation of ['remove_cobblestone','add_sword']) await perform(mutation,async()=>{
    const targets=await setup(a),gathered=await run(a,dispatch(a,targets))
    a.internalHook=async()=>{ await command(mutation==='add_sword'?`give ${a.name} minecraft:stone_sword 1`:`clear ${a.name} minecraft:cobblestone 1`); await until(()=>mutation==='add_sword'?inv(a.bot).stone_sword===1:inv(a.bot).cobblestone===1); record('inventory_mutation_confirmed',{inventory:inv(a.bot)}) }
    const changed=await run(a,dispatch(a,[])),partial=inv(a.bot)
    let allowed=[];if(mutation==='remove_cobblestone'){await command('setblock 0 200 0 minecraft:stone');allowed=[{x:0,y:200,z:0,name:'stone'}]}
    const resumed=await resume(a,allowed);return {gathered,changed,partial,resume:resumed,summary:{code:changed.code||'OK',partial,final:resumed.held}}
  })
  if (selected.includes('pickaxe')) await perform('remove_pickaxe',async()=>{
    const targets=await setup(a)
    a.itemHook=()=>{server.stdin.write(`clear ${a.name} minecraft:stone_pickaxe\n`);record('pickaxe_removal_requested')}
    const changed=await run(a,dispatch(a,targets)),partial=inv(a.bot)
    await command(`give ${a.name} minecraft:stone_pickaxe 1`);await a.bot.equip(a.bot.inventory.items().find(i=>i.name==='stone_pickaxe'),'hand')
    const resumed=await resume(a,targets.filter(t=>a.bot.blockAt(new Vec3(t.x,t.y,t.z))?.name===t.name))
    return {changed,partial,resume:resumed,summary:{code:changed.code||'OK',partial,final:resumed.held}}
  })
  await sleep(2500)
  fs.writeFileSync(path.join(out,'metadata.json'),JSON.stringify({ optIn:process.env.MBOT_DETERMINISTIC_PREPARATION, juliaShadow:true, juliaExecutionAuthority:'none', minecraft:'1.20.1', revision:process.env.TEST_REVISION, selected },null,2))
}
main().catch(e => { record('fatal',{ error:e.stack }); console.error(e); process.exitCode=1 }).finally(async () => { for (const w of workers) { clearInterval(w.probe); w.cancel(); w.bot.quit() } sidecar?.kill(); server?.stdin.write('stop\n'); await sleep(1500); server?.kill() })
