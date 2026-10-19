// Controlled real-world snapshots; model decisions never control the bot.
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { once } = require('events')
const mineflayer = require('mineflayer')
const { Vec3 } = require('vec3')
const { realStateSnapshot } = require('../../../lib/real-state')
const { candidateIntents, applyIntent, deterministicPlayerPolicy } = require('../../../lib/player-loop')
const { ProductionManager } = require('../../../core/ProductionManager')
const { executePreparationStep } = require('../../../lib/forced-preparation')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const { JuliaShadowObserver } = require('../../../lib/julia-shadow')
const out = path.resolve(process.env.ORDER_OUTPUT_DIR || __dirname)
const serverDir = process.env.ORDER_SERVER_DIR
const python = process.env.ORDER_PYTHON
if (!serverDir || !python) throw new Error('Set ORDER_SERVER_DIR and ORDER_PYTHON')
fs.mkdirSync(out, { recursive: true })
if (fs.existsSync(path.join(out, 'rows.json'))) throw new Error('Use fresh output dir')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const rows = [], commands = [], offline = [], shadowEvents = [], physical = []
let server, sidecar, bot, serverReady = false, shadowHttpCalls = 0, cancelled = false
const observer = new JuliaShadowObserver({
  enabled: true, endpoint: 'http://127.0.0.1:8768/choose',
  eventLog: { log(type, data) { shadowEvents.push({ type, data }) } },
  fetchImpl: (...args) => { shadowHttpCalls++; return fetch(...args) }
})

async function command(value) {
  commands.push({ ts: new Date().toISOString(), command: value })
  server.stdin.write(value + '\n')
  await delay(180)
}

async function until(predicate, timeout = 10000) {
  const started = Date.now()
  while (!predicate()) { if (Date.now() - started > timeout) throw new Error('State setup timeout'); await delay(50) }
}

function offlineTransition(row) {
  const initial = row.state
  const gathered = applyIntent(initial, 'gather_materials')
  assert.equal(gathered.result.ok, true)
  assert.equal(gathered.result.safetyViolation, false)
  const nextCandidates = candidateIntents(gathered.state)
  assert(nextCandidates.some(c => c.id === 'prepare_combat'))
  assert(!nextCandidates.some(c => c.id === 'gather_materials'))
  assert(gathered.state.craftable.includes('stone_sword'))
  const choice = deterministicPlayerPolicy(gathered.state, nextCandidates)
  assert.equal(choice, 'prepare_combat')
  const prepared = applyIntent(gathered.state, choice)
  assert.equal(prepared.result.ok, true)
  assert.equal(prepared.result.safetyViolation, false)
  assert.equal(prepared.state.equippedWeapon, 'stone_sword')
  const after = candidateIntents(prepared.state)
  assert.deepEqual(after.map(c => c.id), ['continue_objective'])
  offline.push({ objective: initial.objective.type, initial,
    initial_candidates: row.candidates, gathered, next_candidates: nextCandidates,
    preparation_choice: choice, prepared, final_candidates: after,
    second_gather_forced: false, executionAuthority: 'none', scope: 'offline_applyIntent' })
}

async function sample(scenario, repetition, objective, expected) {
  const task = objective === 'mine_iron' ? { type: 'coletar_blocos', resource: 'iron_ore' } : { type: 'explorar' }
  const state = realStateSnapshot(bot, task, { homeProvider: () => new Vec3(300, 200, 0) })
  state.cancellationRequested = cancelled
  const candidates = candidateIntents(state)
  const before = shadowHttpCalls
  const returned = observer.observe({ state, objective: state.objective, candidates,
    executedChoice: null, resultPromise: Promise.resolve({ ok: true, observationOnly: true }),
    meta: { worker: 'guardrail_probe', taskLineageId: `${scenario}/${repetition}` } })
  assert.equal(returned, undefined)
  assert.equal(observer.inFlight, 0)
  assert.equal(shadowHttpCalls, before)
  const trace_id = `${scenario}/${repetition}`
  const started = performance.now()
  // Diagnostic singleton contract request only; the shadow runtime made no HTTP call.
  const response = await fetch('http://127.0.0.1:8768/choose', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state, candidates, trace_id }), signal: AbortSignal.timeout(4000)
  })
  const body = await response.json()
  const deterministicChoice = deterministicPlayerPolicy(state, candidates)
  const projected = applyIntent(state, deterministicChoice)
  const row = { scenario, repetition, trace_id, state, candidates,
    candidate_ids: candidates.map(c => c.id), deterministic_choice: deterministicChoice,
    projected_offline_result: projected, sidecar: { http: response.status, body,
      wall_latency_ms: performance.now() - started, error: null, timeout: false },
    shadow: { enabled: observer.enabled(), returned_undefined: returned === undefined,
      http_calls_delta: shadowHttpCalls - before, in_flight: observer.inFlight,
      singleton_skipped_before_http: true },
    world: { position: bot.entity.position, held_item: bot.heldItem?.name || null,
      entities: Object.values(bot.entities).filter(e => ['zombie', 'cow'].includes(e.name))
        .map(e => ({ id: e.id, name: e.name, type: e.type, distance: e.position.distanceTo(bot.entity.position), position: e.position })) },
    forced: candidates.length === 1, executionAuthority: 'none' }
  rows.push(row)
  fs.writeFileSync(path.join(out, 'rows.json'), JSON.stringify(rows, null, 2))
  assert.deepEqual(row.candidate_ids, expected)
  assert.equal(response.status, 200)
  assert.equal(body.choice, expected[0])
  assert.equal(body.source, 'forced_single_candidate')
  assert.equal(body.model_calls, 0)
  assert.equal(projected.result.ok, true)
  assert.equal(projected.result.safetyViolation, false)
  assert.equal(state.equippedWeapon, null)
  assert.equal(state.craftable.includes('stone_sword'), false)
  assert.equal(state.craftable.includes('iron_sword'), false)
  assert(!Object.keys(state.inventory).some(k => /sword|axe$/.test(k) && !k.includes('pickaxe')))
  if (objective === 'mine_iron') assert.equal(state.equippedTool, 'stone_pickaxe')
  if (scenario === 'threat') {
    assert.equal(state.threat.type, 'zombie')
    assert(state.threat.distance <= 6)
    assert.equal(projected.state.explored || 0, state.explored || 0)
    assert.equal(projected.state.objective.progress || 0, state.objective.progress || 0)
    assert.equal(projected.state.threat, null)
  } else assert.equal(state.threat, null)
  if (scenario === 'critical_hunger') {
    assert(state.food <= 5)
    assert(state.nearby.food && state.nearby.foodDistance <= 8 && state.nearby.foodDistance < state.baseDistance)
  } else assert.equal(state.food, 20)
  console.log(trace_id, row.candidate_ids, 'forced, model_calls=0, shadow_http_calls=0')
  return row
}

async function reset(materials, pickaxe = false) {
  await command('difficulty peaceful')
  await command('kill @e[type=!minecraft:player]')
  await command('time set day')
  await command('effect clear guardrail_probe')
  await command('clear guardrail_probe')
  await command('fill -8 199 -8 8 199 8 minecraft:dirt')
  await command('fill -8 200 -8 8 204 8 minecraft:air')
  if (materials) {
    await command('setblock 2 200 0 minecraft:oak_log')
    await command('setblock 0 200 2 minecraft:stone')
    if (pickaxe) await command('setblock -2 200 0 minecraft:iron_ore')
  }
  await command('tp guardrail_probe 0.5 200 0.5')
  await command('effect give guardrail_probe minecraft:saturation 1 255 true')
  await delay(1100)
  await command('effect clear guardrail_probe')
  if (pickaxe) {
    await command('give guardrail_probe minecraft:stone_pickaxe 1')
    await until(() => bot.inventory.items().some(i => i.name === 'stone_pickaxe'))
    await bot.equip(bot.inventory.items().find(i => i.name === 'stone_pickaxe'), 'hand')
  }
  await delay(300)
  assert.equal(bot.food, 20)
}

async function main() {
  fs.writeFileSync(path.join(serverDir, 'server.properties'), [
    'server-ip=127.0.0.1', 'server-port=25566', 'online-mode=false', 'enforce-secure-profile=false',
    'level-name=physical-preparation-world', 'level-type=minecraft:flat', 'generate-structures=false',
    'difficulty=peaceful', 'view-distance=3', 'simulation-distance=3', 'spawn-protection=0',
    'max-tick-time=60000', 'allow-flight=true', 'max-players=2', 'enable-rcon=false'
  ].join('\n'))
  server = spawn('java', ['-Xms256M', '-Xmx1024M', '-jar', 'server.jar', 'nogui'], { cwd: serverDir })
  const log = fs.createWriteStream(path.join(out, 'minecraft.log'))
  server.stdout.on('data', data => { log.write(data); if (data.toString().includes('Done (')) serverReady = true })
  server.stderr.pipe(log, { end: false })
  await until(() => serverReady, 90000)
  for (const cmd of ['gamerule doDaylightCycle false', 'time set day', 'gamerule doMobSpawning false', 'gamerule randomTickSpeed 0', 'gamerule naturalRegeneration false']) await command(cmd)
  sidecar = spawn(python, [path.join(__dirname, 'capture_sidecar.py')], {
    env: { ...process.env, JULIA_DEVICE: 'cpu', OMP_NUM_THREADS: '2', MKL_NUM_THREADS: '2',
      HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', USE_TF: '0', ORDER_OUTPUT_DIR: out }
  })
  const juliaLog = fs.createWriteStream(path.join(out, 'sidecar.log'))
  sidecar.stdout.pipe(juliaLog); sidecar.stderr.pipe(juliaLog, { end: false })
  const start = Date.now()
  while (true) {
    try { const r = await fetch('http://127.0.0.1:8768/healthz'); if ((await r.json()).ok) break } catch {}
    if (sidecar.exitCode != null || Date.now() - start > 90000) throw new Error('Julia startup failed')
    await delay(100)
  }
  bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username: 'guardrail_probe', version: '1.20.1', auth: 'offline' })
  bot.on('error', error => fs.appendFileSync(path.join(out, 'bot-errors.log'), String(error) + '\n'))
  bot.loadPlugin(pathfinder)
  await once(bot, 'spawn'); await bot.waitForChunksToLoad()
  const configs = [
    ['wood_stone', {}, ['oak_log', 'stone'], ['gather_materials']],
    ['stick_stone', { stick: 1 }, ['stone'], ['gather_materials']],
    ['cobble_wood', { cobblestone: 2 }, ['oak_log'], ['gather_materials']],
    ['wood_only', {}, ['oak_log'], ['continue_objective']],
    ['stone_only', {}, ['stone'], ['continue_objective']],
    ['iron_only', {}, ['iron_ore'], ['continue_objective']],
    ['iron_stone_no_stick', {}, ['iron_ore', 'stone'], ['continue_objective']],
    ['one_plank_stone', { oak_planks: 1 }, ['stone'], ['continue_objective']]
  ]
  if (!process.env.PHYSICAL_ONLY) {
  for (const [name, inventory, blocks, expected] of configs) for (let i = 1; i <= 2; i++) {
    await reset(false)
    for (const [item, count] of Object.entries(inventory)) await command(`give guardrail_probe minecraft:${item} ${count}`)
    for (let j = 0; j < blocks.length; j++) await command(`setblock ${j ? 0 : 2} 200 ${j ? 2 : 0} minecraft:${blocks[j]}`)
    await delay(250)
    await sample(name, i, 'explore', expected)
  }
  for (let i = 1; i <= 2; i++) {
    await reset(true); await command('difficulty normal'); await command('time set midnight')
    await command('summon minecraft:zombie 4.5 200 0.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b}')
    await until(() => Object.values(bot.entities).some(e => e.name === 'zombie'))
    await sample('threat', i, 'explore', ['escape_danger'])
  }
  for (let i = 1; i <= 2; i++) {
    await reset(true); await command('difficulty normal')
    await command('summon minecraft:cow -2.5 200 0.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b}')
    await until(() => Object.values(bot.entities).some(e => e.name === 'cow'))
    await command('effect give guardrail_probe minecraft:hunger 10 255 true')
    await until(() => bot.food <= 5); await command('effect clear guardrail_probe minecraft:hunger')
    await sample('critical_hunger', i, 'explore', ['find_food'])
  }
  for (let i = 1; i <= 2; i++) {
    await reset(true); cancelled = true
    await sample('cancel', i, 'explore', ['stop_task']); cancelled = false
  }
  }
  const moves = new Movements(bot); moves.canDig = false; moves.allow1by1towers = false
  moves.allowSprinting = false; moves.scafoldingBlocks = []
  bot.pathfinder.setMovements(moves); bot.pathfinder.tickTimeout = 8
  for (const route of ['stick_stone', 'cobble_wood']) {
    await reset(false)
    const targets = []
    if (route === 'stick_stone') {
      await command('give guardrail_probe minecraft:stick 1')
      await command('give guardrail_probe minecraft:stone_pickaxe 1')
      await bot.equip(bot.inventory.items().find(i => i.name === 'stone_pickaxe'), 'hand')
      for (const [x, z] of [[2, 0], [0, 2]]) {
        await command(`setblock ${x} 200 ${z} minecraft:stone`)
        targets.push({ x, y: 200, z, name: 'stone' })
      }
    } else {
      await command('give guardrail_probe minecraft:cobblestone 2')
      await command('setblock 2 200 0 minecraft:oak_log')
      targets.push({ x: 2, y: 200, z: 0, name: 'oak_log' })
    }
    await command('setblock -1 200 -1 minecraft:crafting_table')
    await delay(250)
    const production = new ProductionManager({ storage: null })
    production.rememberCraftingTable(bot, bot.blockAt(new Vec3(-1, 200, -1)))
    const run = { route, cycles: [], errors: [], timeouts: 0, loops: 0, safetyViolations: 0, juliaExecutionAuthority: 'none' }
    physical.push(run)
    const seen = new Set()
    for (let cycle = 0; cycle < 3; cycle++) {
      const state = realStateSnapshot(bot, { type: 'explorar' }, { homeProvider: () => new Vec3(300, 200, 0) })
      const candidates = candidateIntents(state)
      if (bot.heldItem?.name === 'stone_sword' && candidates.some(c => c.id === 'continue_objective')) break
      const signature = JSON.stringify([state.inventory, state.equippedWeapon, candidates])
      if (seen.has(signature)) { run.loops++; throw new Error('Repeated preparation state') }
      seen.add(signature)
      observer.observe({ state, objective: state.objective, candidates, executedChoice: null,
        resultPromise: Promise.resolve({ ok: true, observationOnly: true }), meta: { worker: 'physical_probe' } })
      while (observer.inFlight) await delay(20)
      const result = await executePreparationStep({ enabled: true, bot, task: { type: 'explorar' },
        production, allowedTargets: targets, homeProvider: () => new Vec3(300, 200, 0), timeoutMs: 20000 })
      run.cycles.push(result)
      if (!result.ok) {
        run.errors.push(result.code)
        if (result.code === 'TIMEOUT') run.timeouts++
      }
      fs.writeFileSync(path.join(out, 'physical.json'), JSON.stringify(physical, null, 2))
      assert.equal(result.ok, true, JSON.stringify(result))
    }
    run.final = realStateSnapshot(bot, { type: 'explorar' }, { homeProvider: () => new Vec3(300, 200, 0) })
    run.nextCandidates = candidateIntents(run.final)
    assert.equal(bot.heldItem.name, 'stone_sword')
    assert.deepEqual(run.nextCandidates.map(c => c.id), ['continue_objective'])
    assert.equal(run.cycles.filter(c => c.intent === 'gather_materials').length, 1)
    assert.equal(run.cycles.length, 2)
    console.log('PHYSICAL PASS', route, run.cycles.map(c => c.intent), 'stone_sword equipped')
    fs.writeFileSync(path.join(out, 'physical.json'), JSON.stringify(physical, null, 2))
  }
  fs.writeFileSync(path.join(out, 'shadow-stats.json'), JSON.stringify({ stats: observer.stats, shadowHttpCalls, events: shadowEvents, executionAuthority: 'none' }, null, 2))
  console.log('PASS:', rows.length, 'real guardrail snapshots; 2 physical preparations; Julia authority none')
}

main().catch(error => {
  fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ error: String(error), stack: error.stack }, null, 2))
  console.error(error); process.exitCode = 1
}).finally(async () => {
  fs.writeFileSync(path.join(out, 'minecraft-commands.json'), JSON.stringify(commands, null, 2))
  bot?.quit(); sidecar?.kill('SIGTERM')
  if (server && server.exitCode == null) {
    server.stdin.write('stop\n'); await Promise.race([once(server, 'exit'), delay(5000)])
    if (server.exitCode == null) server.kill('SIGTERM')
  }
})
