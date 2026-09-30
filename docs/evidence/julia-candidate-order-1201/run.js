// Short controlled test. All choices are observed; none are applied to Minecraft.
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { once } = require('events')
const mineflayer = require('mineflayer')
const { Vec3 } = require('vec3')
const { realStateSnapshot } = require('../../../lib/real-state')
const { candidateIntents } = require('../../../lib/player-loop')
const { JuliaShadowObserver } = require('../../../lib/julia-shadow')
const out = path.resolve(process.env.ORDER_OUTPUT_DIR || __dirname)
fs.mkdirSync(out, { recursive: true })
if (fs.existsSync(path.join(out, 'requests.jsonl')) || fs.existsSync(path.join(out, 'sidecar-traces.jsonl'))) {
  throw new Error('Use a fresh ORDER_OUTPUT_DIR to preserve previous evidence')
}
const serverDir = process.env.ORDER_SERVER_DIR
const python = process.env.ORDER_PYTHON
if (!serverDir || !python) throw new Error('Set ORDER_SERVER_DIR and ORDER_PYTHON')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const clone = x => JSON.parse(JSON.stringify(x))
const rows = []
const commands = []
let server, sidecar, bot
let serverReady = false
let traceId
let lastResponse
const shadowRows = []
const observer = new JuliaShadowObserver({
  enabled: true, endpoint: 'http://127.0.0.1:8768/choose', timeoutMs: 4000,
  eventLog: { log(type, data, worker) { shadowRows.push({ type, data, worker }) } },
  fetchImpl: async (url, options) => {
    const payload = JSON.parse(options.body)
    payload.trace_id = traceId
    const started = performance.now()
    try {
      const response = await fetch(url, { ...options, body: JSON.stringify(payload) })
      lastResponse = { http: response.status, body: await response.clone().json(),
        wall_latency_ms: performance.now() - started, error: null }
      return response
    } catch (error) {
      lastResponse = { http: null, body: null, wall_latency_ms: performance.now() - started,
        error: String(error), timeout: error.name === 'AbortError' || error.name === 'TimeoutError' }
      throw error
    }
  }
})

async function command(value) {
  commands.push({ ts: new Date().toISOString(), command: value })
  server.stdin.write(value + '\n')
  await delay(180)
}

async function pair(phase, objective, index, state, world) {
  const candidates = candidateIntents(state)
  const byId = Object.fromEntries(candidates.map(c => [c.id, c]))
  if (candidates.length !== 2 || !byId.gather_materials || !byId.continue_objective) {
    throw new Error('Unexpected candidates: ' + JSON.stringify(candidates))
  }
  for (const [label, ids] of Object.entries({
    A: ['gather_materials', 'continue_objective'],
    B: ['continue_objective', 'gather_materials']
  })) {
    traceId = `${phase}/${objective}/${index}/${label}`
    lastResponse = null
    const selected = ids.map(id => clone(byId[id]))
    const before = shadowRows.length
    const returned = observer.observe({ state: clone(state), objective: clone(state.objective),
      candidates: selected, executedChoice: null,
      resultPromise: Promise.resolve({ ok: true, observationOnly: true }),
      meta: { worker: 'order_probe', taskLineageId: traceId } })
    if (returned !== undefined) throw new Error('Shadow returned authority')
    while (observer.inFlight) await delay(20)
    const row = { phase, objective, pair: index, label, trace_id: traceId,
      state: clone(state), world, candidates: selected, received_order: ids,
      response: lastResponse, shadow_events: shadowRows.slice(before), executionAuthority: 'none' }
    rows.push(row)
    fs.appendFileSync(path.join(out, 'requests.jsonl'), JSON.stringify(row) + '\n')
    if (!lastResponse || lastResponse.http !== 200) throw new Error('Inference failed: ' + JSON.stringify(row))
    console.log(traceId, lastResponse.body.choice, lastResponse.body.probabilities)
  }
}

async function main() {
  fs.writeFileSync(path.join(serverDir, 'server.properties'), [
    'server-ip=127.0.0.1', 'server-port=25566', 'online-mode=false',
    'enforce-secure-profile=false', 'level-name=order-world', 'level-type=minecraft:flat',
    'generate-structures=false', 'difficulty=peaceful', 'view-distance=3',
    'simulation-distance=3', 'spawn-protection=0', 'max-tick-time=60000',
    'allow-flight=true', 'max-players=2', 'enable-rcon=false'
  ].join('\n'))
  server = spawn('java', ['-Xms256M', '-Xmx1024M', '-jar', 'server.jar', 'nogui'], { cwd: serverDir })
  const serverLog = fs.createWriteStream(path.join(out, 'minecraft.log'))
  server.stdout.on('data', data => { serverLog.write(data); if (data.toString().includes('Done (')) serverReady = true })
  server.stderr.pipe(serverLog, { end: false })
  const startup = Date.now()
  while (!serverReady) { if (server.exitCode != null || Date.now() - startup > 90000) throw new Error('Minecraft startup failed'); await delay(200) }
  await command('gamerule doDaylightCycle false')
  await command('time set day')
  await command('gamerule doMobSpawning false')
  await command('gamerule randomTickSpeed 0')
  sidecar = spawn(python, [path.join(__dirname, 'capture_sidecar.py')], {
    env: { ...process.env, JULIA_DEVICE: 'cpu', OMP_NUM_THREADS: '2', MKL_NUM_THREADS: '2',
      HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', USE_TF: '0', ORDER_OUTPUT_DIR: out }
  })
  const sidecarLog = fs.createWriteStream(path.join(out, 'sidecar.log'))
  sidecar.stdout.pipe(sidecarLog); sidecar.stderr.pipe(sidecarLog, { end: false })
  const startSidecar = Date.now()
  while (true) {
    try { const r = await fetch('http://127.0.0.1:8768/healthz'); if ((await r.json()).ok) break } catch {}
    if (sidecar.exitCode != null || Date.now() - startSidecar > 90000) throw new Error('Julia startup failed')
    await delay(200)
  }
  bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username: 'order_probe', version: '1.20.1', auth: 'offline' })
  bot.on('error', error => fs.appendFileSync(path.join(out, 'bot-errors.log'), String(error) + '\n'))
  await once(bot, 'spawn')
  await bot.waitForChunksToLoad()
  const templates = {}
  const liveConfigs = [
    { materials: ['wood', 'stone'], d: 2 },
    { materials: ['wood', 'stone'], d: 4, diagonal: true },
    { materials: ['wood'], d: 2 },
    { materials: ['stone', 'iron'], d: 2 },
    { materials: ['wood', 'stone', 'iron'], d: 4 }
  ]
  const block = { wood: 'oak_log', stone: 'stone', iron: 'iron_ore' }
  for (const objective of ['explore', 'mine_iron']) {
    for (let index = 0; index < liveConfigs.length; index++) {
      const cfg = liveConfigs[index]
      await command('fill -8 199 -8 8 199 8 minecraft:dirt')
      await command('fill -8 200 -8 8 203 8 minecraft:air')
      for (let k = 0; k < cfg.materials.length; k++) {
        const [x, z] = cfg.diagonal ? [[4, 4], [-4, -4], [4, -4]][k] : [[cfg.d, 0], [0, cfg.d], [-cfg.d, 0]][k]
        await command(`setblock ${x} 200 ${z} minecraft:${block[cfg.materials[k]]}`)
      }
      await command('clear order_probe')
      if (objective === 'mine_iron') await command('give order_probe minecraft:stone_pickaxe 1')
      await command('tp order_probe 0.5 200 0.5')
      await delay(700)
      if (objective === 'mine_iron') await bot.equip(bot.inventory.items().find(i => i.name === 'stone_pickaxe'), 'hand')
      const task = objective === 'explore' ? { type: 'explorar' } : { type: 'coletar_blocos', resource: 'iron_ore' }
      const state = realStateSnapshot(bot, task, { homeProvider: () => new Vec3(300, 200, 0) })
      if (state.health !== 20 || state.food !== 20 || state.threat) throw new Error('Uncontrolled survival state')
      const world = { config: cfg, position: bot.entity.position, inventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count })) }
      templates[objective] ||= clone(state)
      if (objective === 'explore' && index === 0) {
        // One real warm-up, separately labelled and excluded from the 44 measured calls.
        const r = await fetch('http://127.0.0.1:8768/choose', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ state, candidates: candidateIntents(state), trace_id: 'warmup' }) })
        fs.writeFileSync(path.join(out, 'warmup.json'), JSON.stringify({ http: r.status, body: await r.json() }, null, 2))
        if (!r.ok) throw new Error('Warmup failed')
      }
      await pair('live', objective, index + 1, state, world)
    }
  }
  bot.quit()
  for (const objective of ['explore', 'mine_iron']) {
    let index = 0
    for (const materials of [['wood'], ['wood', 'stone'], ['wood', 'stone', 'iron']]) {
      for (const d of [2, 6]) {
        const state = clone(templates[objective])
        for (const material of ['wood', 'stone', 'iron']) {
          state.nearby[material] = materials.includes(material)
          state.nearby[material + 'Distance'] = materials.includes(material) ? d : null
        }
        await pair('offline', objective, ++index, state, null)
      }
    }
  }
  fs.writeFileSync(path.join(out, 'shadow.jsonl'), shadowRows.map(r => JSON.stringify(r)).join('\n') + '\n')
  console.log('Completed:', rows.length, 'measured calls; authority none')
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  fs.writeFileSync(path.join(out, 'minecraft-commands.json'), JSON.stringify(commands, null, 2))
  bot?.quit()
  sidecar?.kill('SIGTERM')
  if (server && server.exitCode == null) {
    server.stdin.write('stop\n')
    await Promise.race([once(server, 'exit'), delay(5000)])
    if (server.exitCode == null) server.kill('SIGTERM')
  }
})
