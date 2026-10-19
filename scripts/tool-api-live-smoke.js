'use strict'

// Runs the actual index.js, not a replacement executor. Only disposable worlds.
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const assert = require('node:assert/strict')

const repo = path.resolve(__dirname, '..')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(fn, timeout = 30000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const result = await fn().catch(() => null)
    if (result) return result
    await sleep(100)
  }
  throw new Error('smoke phase timed out')
}
async function freePort() {
  const server = net.createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function main() {
  if (!process.env.MBOT_TEST_SERVER_JAR || process.env.MBOT_TEST_EULA_ACCEPTED !== '1') throw new Error('Set MBOT_TEST_SERVER_JAR and MBOT_TEST_EULA_ACCEPTED=1 for an isolated Minecraft test')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mbot-tool-live-'))
  const serverDir = path.join(dir, 'server'), appDir = path.join(dir, 'app')
  await fs.mkdir(serverDir); await fs.mkdir(appDir)
  const [mcPort, apiPort] = await Promise.all([freePort(), freePort()])
  await fs.copyFile(process.env.MBOT_TEST_SERVER_JAR, path.join(serverDir, 'server.jar'))
  await fs.writeFile(path.join(serverDir, 'eula.txt'), 'eula=true\n')
  await fs.writeFile(path.join(serverDir, 'server.properties'), `server-ip=127.0.0.1\nserver-port=${mcPort}\nonline-mode=false\nspawn-protection=0\ndifficulty=peaceful\ngamemode=survival\nlevel-type=minecraft:flat\nview-distance=3\nsimulation-distance=3\nmax-players=4\n`)
  const report = { minecraft: '1.20.1', dir, mcPort, apiPort, phases: [] }
  const pass = (phase, evidence) => { report.phases.push({ phase, status: 'PASS', evidence }); console.log(`PASS ${phase}: ${JSON.stringify(evidence)}`) }
  const checkpointFile = path.join(appDir, 'checkpoints.json')
  const stateFile = path.join(appDir, 'colony-state.json')
  await fs.writeFile(stateFile, JSON.stringify({ version: 1, workers: { ajudante: 1 }, auto: false, companionAuto: false }))
  const server = spawn('java', ['-Xms512M', '-Xmx1536M', '-jar', 'server.jar', 'nogui'], { cwd: serverDir, stdio: ['pipe', 'pipe', 'pipe'] })
  let serverLog = '', app = null, appLog = '', run = 0
  server.stdout.on('data', chunk => { serverLog += chunk })
  server.stderr.on('data', chunk => { serverLog += chunk })
  const command = async text => { server.stdin.write(text + '\n'); await sleep(400) }
  const api = async (url, body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${apiPort}${url}`, { signal: AbortSignal.timeout(45000), ...(body !== undefined ? { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) } : { headers }) })
    return { status: response.status, data: await response.json() }
  }
  async function startApp(enabled) {
    appLog = ''; run++
    app = spawn(process.execPath, [path.join(repo, 'index.js')], { cwd: appDir, stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, MINECRAFT_HOST: '127.0.0.1', MINECRAFT_PORT: String(mcPort), MINECRAFT_VERSION: '1.20.1', MINECRAFT_BOT_NAME: 'tool_main', MINECRAFT_OWNER: 'absent_smoke_owner',
      MBOT_TOOL_API: enabled ? '1' : '0', MBOT_TOOL_API_PORT: String(apiPort), MBOT_TASK_CHECKPOINT_FILE: checkpointFile,
      COLONY_STATE_FILE: stateFile, MEMORY_FILE: path.join(appDir, 'memory.json'), COLONY_EVENT_LOG: path.join(appDir, 'events.jsonl'),
      MBOT_JULIA_AUTHORITY: '0', MBOT_JULIA_SHADOW: '0', MBOT_LAYA_SHADOW: '0', MBOT_WORLD_MEMORY: '0', MBOT_EXPLORE_PREPARATION: '0', MBOT_DETERMINISTIC_PREPARATION: '0', MBOT_PLUGINS: '0', MBOT_VIEWER_PORT: '0', MBOT_INVENTORY_PORT: '0', MBOT_DASHBOARD: '0', STATUS_SERVER: '0', MINECRAFT_LAN_ANNOUNCE: '0'
    } })
    app.stdout.on('data', chunk => { appLog += chunk })
    app.stderr.on('data', chunk => { appLog += chunk })
    await waitFor(async () => appLog.includes('ajudante_01 conectado como ajudante'))
    if (enabled) await waitFor(async () => {
      const result = await api('/v1/workers/ajudante_01/state')
      return result.data.position && !result.data.busy && result.data.health > 0
    })
  }
  async function stopApp(enabled) {
    const current = app
    if (!current) return
    const exit = once(current, 'exit')
    if (enabled) current.kill('SIGTERM'); else current.kill('SIGKILL')
    const [code] = await Promise.race([exit, sleep(8000).then(() => { current.kill('SIGKILL'); throw new Error('app shutdown timed out') })])
    await fs.writeFile(path.join(dir, `app-${run}.log`), appLog)
    app = null
    if (enabled) assert.equal(code, 0)
    await sleep(1000)
  }
  try {
    await waitFor(async () => serverLog.includes('Done ('), 60000)
    await command('gamerule doDaylightCycle false'); await command('time set day'); await command('gamerule spawnRadius 0')
    await command('fill -12 66 -12 12 70 12 dirt'); await command('fill -12 71 -12 12 78 12 air'); await command('setworldspawn 4 71 0')
    await command('fill 0 71 0 0 76 0 oak_log')
    await startApp(false)
    await assert.rejects(api('/health'))
    await assert.rejects(fs.access(checkpointFile))
    pass('default_off', { listener: false, checkpointCreated: false })
    await stopApp(false)
    await startApp(true)
    const worker = (await api('/v1/workers')).data.find(w => w.id === 'ajudante_01')
    assert(worker.connected && worker.tools.includes('gather'))
    pass('runtime_worker_attached', worker)
    const gather = { task_id: 'live-gather-1', objective: 'collect one actual oak log', args: { resource: 'oak_log', quantity: 1 } }
    const gathered = await api('/v1/workers/ajudante_01/tools/gather', gather)
    assert.equal(gathered.data.success, true)
    const inventory = (await api('/v1/workers/ajudante_01/state')).data.inventory
    assert(inventory.oak_log >= 1)
    pass('http_gather_real_inventory', { success: gathered.data.success, gathered: gathered.data.result.gathered, inventory })
    const request = { task_id: 'live-move-1', args: { position: { x: 6, y: 71, z: 0 } } }
    const moved = await api('/v1/workers/ajudante_01/tools/move_to', request)
    assert.equal(moved.data.success, true)
    const position = (await api('/v1/workers/ajudante_01/state')).data.position
    assert(Math.hypot(position.x - 6, position.y - 71, position.z) <= 2)
    pass('http_move_real_position', position)
    const before = inventory.oak_log
    assert.equal((await api('/v1/workers/ajudante_01/tools/gather', gather)).data.replayed, true)
    assert.equal((await api('/v1/workers/ajudante_01/state')).data.inventory.oak_log, before)
    pass('idempotent_replay', { unchangedLogs: before })
    const bad = await api('/v1/workers/ajudante_01/tools/gather', { task_id: 'external', args: { resource: 'oak_log', quantity: 1 } }, { origin: 'https://evil.example' })
    assert.equal(bad.status, 403)
    pass('external_origin_blocked', { status: bad.status })
    const pending = api('/v1/workers/ajudante_01/tools/gather', { task_id: 'live-cancel-1', args: { resource: 'oak_log', quantity: 5 } })
    await waitFor(async () => (await api('/v1/workers/ajudante_01/state')).data.currentTask?.type === 'coletar_blocos')
    const busy = await api('/v1/workers/ajudante_01/tools/move_to', { args: { position: { x: 4, y: 71, z: 0 } } })
    assert.equal(busy.data.reason, 'worker_busy')
    assert.equal((await api('/v1/workers/ajudante_01/tools/stop', { task_id: 'live-stop-1' })).data.success, true)
    const cancelled = await pending
    assert.equal(cancelled.data.success, false)
    assert.equal(cancelled.data.reason, 'cancelled')
    pass('busy_and_stop_real_task', { busy: busy.data.reason, cancelled: cancelled.data.reason })
    await stopApp(true)
    await assert.rejects(api('/health'))
    pass('sigterm_closes_listener', { exitCode: 0 })
    await startApp(true)
    const restored = await api('/v1/workers/ajudante_01/tools/gather', gather)
    assert.equal(restored.data.replayed, true)
    const stored = JSON.parse(await fs.readFile(checkpointFile, 'utf8'))
    assert.equal(stored.tasks['live-gather-1'].attempts, 1)
    assert.equal(stored.tasks['live-cancel-1'].status, 'cancelled')
    pass('restart_checkpoint_replay', { attempts: stored.tasks['live-gather-1'].attempts, cancelledStatus: stored.tasks['live-cancel-1'].status })
    await stopApp(true)
    report.status = 'PASS'
  } catch (error) {
    report.status = 'FAIL'; report.error = error.stack
    throw error
  } finally {
    if (app) { app.kill('SIGKILL'); await fs.writeFile(path.join(dir, `app-${run}.log`), appLog) }
    server.stdin.write('stop\n')
    await Promise.race([once(server, 'exit'), sleep(5000).then(() => server.kill('SIGKILL'))])
    await fs.writeFile(path.join(dir, 'server.log'), serverLog)
    await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(`Evidence: ${dir}`)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
