// Test-only real-server harness. Hooks observe packets/inventory, never fake physical outcomes.
const fs = require('fs'), path = require('path'), { spawn } = require('child_process'), { once } = require('events')
const mineflayer = require('mineflayer'), { Vec3 } = require('vec3'), { pathfinder } = require('mineflayer-pathfinder')
const { WorkerController } = require('../../../core/WorkerController')
const { ProductionManager } = require('../../../core/ProductionManager')
const { JuliaShadowObserver } = require('../../../lib/julia-shadow')
const { realStateSnapshot } = require('../../../lib/real-state')
const { candidateIntents } = require('../../../lib/player-loop')
const gather = require('../../../lib/gather')
const out = path.resolve(process.env.ORDER_OUTPUT_DIR), serverDir = process.env.ORDER_SERVER_DIR
fs.mkdirSync(out, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const rows = [], workers = [], pending = []
let server, sidecar, ready = false, scenario = 'startup', seq = 0
const record = (event, data = {}) => fs.appendFileSync(path.join(out, 'timeline.jsonl'), JSON.stringify({ seq: ++seq, at: new Date().toISOString(), scenario, event, ...data }) + '\n')
const inv = b => Object.fromEntries(b.inventory.items().map(i => i.name).map(n => [n, b.inventory.items().filter(i => i.name === n).reduce((s, i) => s + i.count, 0)]))
const state = w => realStateSnapshot(w.bot, { type: 'explorar' }, { homeProvider: w.homeProvider })
const until = async (fn, ms = 10000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw Error('HARNESS_SETUP_TIMEOUT'); await sleep(25) } }
const command = async c => { record('console', { command: c }); server.stdin.write(c + '\n'); await sleep(180) }
const shadow = new JuliaShadowObserver({ enabled: true, endpoint: 'http://127.0.0.1:8768/choose', eventLog: { log: (type, data) => record('shadow', { type, data }) } })
const originalMine = gather.mineBlocks
gather.mineBlocks = async (b, predicate, count, cancelled, options) => originalMine(b, predicate, count, cancelled, { ...options, onAttempt(a) { record('gather_attempt', { worker: b.username, taskVersion: b.worker.taskVersion, attempt: a }); options.onAttempt(a) } })
function instrument(w) {
  const b = w.bot; b.worker = w; let active = 0
  for (const name of ['dig', 'craft', 'equip']) {
    const original = b[name].bind(b)
    b[name] = async (...args) => {
      const version = w.taskVersion, item = args[0]?.name || args[0]?.result?.id || null
      record(name + '_start', { worker: w.name, taskVersion: version, item, target: args[0]?.position, active: ++active, inventory: inv(b) })
      if (name === 'craft') b.craftWindow = true
      try { const result = await original(...args); record(name + '_end', { worker: w.name, taskVersion: version, currentVersion: w.taskVersion, inventory: inv(b) }); return result }
      catch (error) { record(name + '_error', { worker: w.name, taskVersion: version, currentVersion: w.taskVersion, message: error.message, inventory: inv(b) }); throw error }
      finally { if (name === 'craft') b.craftWindow = false; active-- }
    }
  }
  for (const method of ['runDeterministicPreparation', 'goToPoint']) {
    const original = w[method].bind(w)
    w[method] = async (...args) => { record('owned_task_entry', { worker:w.name, method, taskVersion:w.taskVersion, currentTask:w.currentTask }); return original(...args) }
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
  w.cancel(); w.itemHook = null; w.craftHook = null
  await command('difficulty peaceful'); await command('time set day'); await command('kill @e[type=!minecraft:player]')
  const x = w.name === 'prep_A' ? 0 : 12
  await command(`clear ${w.name}`)
  await command(`fill ${x - 5} 199 -5 ${x + 5} 199 5 minecraft:dirt`)
  await command(`fill ${x - 5} 200 -5 ${x + 5} 204 5 minecraft:air`)
  await command(`tp ${w.name} ${x + .5} 200 0.5`)
  await command(`effect give ${w.name} minecraft:saturation 1 255 true`); await sleep(1100)
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
async function resume(w, allowedTargets) {
  const results = []
  for (let n = 0; n < 3; n++) {
    const before = state(w), candidates = candidateIntents(before).map(c => c.id)
    if (w.bot.heldItem?.name === 'stone_sword') break
    const result = await run(w, prep(allowedTargets)); results.push(result)
    if (!result.ok) break
  }
  return { results, inventory: inv(w.bot), held: w.bot.heldItem?.name || null, candidates: candidateIntents(state(w)).map(c => c.id) }
}
async function perform(name, fn) {
  scenario = name; const started = Date.now(); record('scenario_start')
  try { const result = await fn(); rows.push({ scenario: name, elapsed_ms: Date.now() - started, ...result }); console.log(name, JSON.stringify(result.summary || result.resume?.candidates || result.code || 'done')) }
  catch (error) { rows.push({ scenario: name, elapsed_ms: Date.now() - started, harnessError: error.stack }); record('scenario_error', { error: error.stack }); console.log(name, 'FAILED', error.message) }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(rows, null, 2)); record('scenario_end')
}
async function main() {
  fs.writeFileSync(path.join(serverDir, 'server.properties'), ['server-ip=127.0.0.1','server-port=25566','online-mode=false','enforce-secure-profile=false','level-name=interruption-world','level-type=minecraft:flat','generate-structures=false','difficulty=peaceful','view-distance=3','simulation-distance=3','spawn-protection=0','allow-flight=true','max-players=3'].join('\n'))
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
  for (const name of ['prep_A', 'prep_B']) {
    const b = mineflayer.createBot({ host:'127.0.0.1', port:25566, username:name, version:'1.20.1', auth:'offline' }); b.loadPlugin(pathfinder)
    const w = new WorkerController({ bot:b, name, role:'worker', homeProvider: () => new Vec3(100, 200, 0), ownerProvider: () => null, production:new ProductionManager({ storage:null }), shadow, logger:{ log: message => record('worker_log', { worker:name, message }) } })
    workers.push(w); b.on('error', e => record('bot_error', { worker:name, message:e.message })); await once(b, 'spawn'); await b.waitForChunksToLoad(); instrument(w)
  }
  const [a,b] = workers, selected = (process.env.SCENARIOS || 'new_order,threat,craft,concurrency,cross_workers,obstacle').split(',')
  if (selected.includes('new_order')) await perform('new_order', async () => {
    const targets = await setup(a); let replacement
    a.itemHook = () => { replacement = replace(a); pending.push(replacement) }
    const interrupted = await run(a, prep(targets)); if (replacement) await replacement
    const partial = inv(a.bot); await sleep(500)
    const resumed = await resume(a, [targets[1]])
    return { interrupted, partial, resume:resumed, summary:{ code:interrupted.code, partial, remaining:interrupted.remainingPlan, final:resumed.held } }
  })
  if (selected.includes('threat')) await perform('threat', async () => {
    const targets = await setup(a); await command('difficulty normal'); await command('time set midnight')
    a.itemHook = () => { record('threat_requested'); server.stdin.write(`summon minecraft:zombie ${a.bot.entity.position.x + 3} 200 ${a.bot.entity.position.z} {NoAI:1b,Silent:1b,PersistenceRequired:1b}\n`) }
    const interrupted = await run(a, prep(targets)); const partial = inv(a.bot)
    await command('kill @e[type=minecraft:zombie]'); await command('difficulty peaceful'); await command('time set day'); await until(() => state(a).time === 'day' && !state(a).threat)
    const resumed = await resume(a, targets.filter(t => a.bot.blockAt(new Vec3(t.x,t.y,t.z))?.name === t.name))
    return { interrupted, partial, resume:resumed, summary:{ code:interrupted.code, partial, final:resumed.held } }
  })
  if (selected.includes('craft')) for (const route of ['log', 'sword']) await perform('craft_' + route, async () => {
    await setup(a, route); let replacement
    a.craftHook = () => { replacement = replace(a); pending.push(replacement) }
    const interrupted = await run(a, prep()); if (replacement) await replacement
    await sleep(500); const partial = inv(a.bot), resumed = await resume(a, [])
    return { interrupted, partial, resume:resumed, summary:{ code:interrupted.code, partial, final:resumed.held } }
  })
  if (selected.includes('concurrency')) await perform('same_worker_concurrency', async () => {
    const targets = await setup(a), first = run(a, prep(targets)); await until(() => Boolean(a.bot.targetDigBlock))
    const second = run(a, prep(targets)); const results = await Promise.all([first,second])
    const resumed = await resume(a, targets.filter(t => a.bot.blockAt(new Vec3(t.x,t.y,t.z))?.name === t.name))
    return { results, resume:resumed, summary:{ codes:results.map(r => r.code || 'OK'), final:resumed.held } }
  })
  if (selected.includes('cross_workers')) await perform('cross_workers', async () => {
    const at = await setup(a), bt = await setup(b)
    const results = await Promise.all([run(a,prep(at)),run(b,prep(bt))])
    const resumed = await Promise.all([resume(a,[]),resume(b,[])])
    return { results, resumes:resumed, summary:{ codes:results.map(r => r.code || 'OK'), held:resumed.map(r => r.held) } }
  })
  if (selected.includes('obstacle')) await perform('obstacle', async () => {
    const targets = await setup(a, 'stone', true), first = await run(a,prep(targets)), partial = inv(a.bot)
    const alternative = { x:-2,y:200,z:2,name:'stone' }
    await command('setblock -2 200 2 minecraft:stone')
    const resumed = await resume(a,[...targets.filter(t => a.bot.blockAt(new Vec3(t.x,t.y,t.z))?.name === t.name),alternative])
    return { first, partial, resume:resumed, summary:{ code:first.code || 'OK', partial, final:resumed.held } }
  })
  await sleep(2500)
  fs.writeFileSync(path.join(out,'metadata.json'),JSON.stringify({ optIn:process.env.MBOT_DETERMINISTIC_PREPARATION, juliaShadow:true, juliaExecutionAuthority:'none', minecraft:'1.20.1', revision:process.env.TEST_REVISION, selected },null,2))
}
main().catch(e => { record('fatal',{ error:e.stack }); console.error(e); process.exitCode=1 }).finally(async () => { for (const w of workers) { w.cancel(); w.bot.quit() } sidecar?.kill(); server?.stdin.write('stop\n'); await sleep(1500); server?.kill() })
