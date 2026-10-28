'use strict'

// Diagnostic candidate plugins only. Never integrated into production runtime.
// Every case runs in an ephemeral vanilla Minecraft 1.20.1 world and process.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const mineflayer = require('mineflayer')
const { Vec3 } = require('vec3')

const candidate = process.argv[2]
const supported = ['tps', 'death-event', 'bloodhound']
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(fn, ms = 14000, label = 'condition') {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await sleep(100)
  }
  throw new Error('Timed out: ' + label)
}
async function portFree() {
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function main() {
  assert(supported.includes(candidate), 'Usage: node scripts/plugin-candidate-smoke.js <' + supported.join('|') + '>')
  assert.equal(process.env.MBOT_TEST_EULA_ACCEPTED, '1', 'explicit EULA acceptance required')
  assert(process.env.MBOT_TEST_SERVER_JAR, 'official 1.20.1 jar required')
  await fs.access(process.env.MBOT_TEST_SERVER_JAR)
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mbot-plugin-candidate-'))
  const reports = path.resolve(process.env.MBOT_PLUGIN_EVIDENCE_DIR || 'plugin-candidate-evidence')
  await fs.mkdir(reports, { recursive: true })
  const report = {
    plugin: candidate, minecraft: '1.20.1', status: 'FAIL', checks: [],
    scope: 'isolated vanilla Minecraft, not production or Forge',
    limitations: ['one diagnostic run', 'no production integration', 'no multi-worker soak']
  }
  const record = (check, passed, details = {}) => {
    const entry = { check, status: passed ? 'PASS' : 'FAIL', details }
    report.checks.push(entry)
    console.log('CHECK', JSON.stringify(entry))
    return passed
  }
  let server = null, serverLog = '', bot = null, actor = null, stopped = false
  const errors = []
  async function command(value) {
    assert(server?.exitCode === null, 'server not running')
    server.stdin.write(value + '\n')
    await sleep(400)
  }
  async function createActor(port) {
    const client = mineflayer.createBot({ host:'127.0.0.1', port, username:'attacker_probe', version:'1.20.1', auth:'offline' })
    client.on('error', e => errors.push('actor: ' + e.message))
    await waitFor(() => client.entity && client.registry, 25000, 'actor spawn')
    await client.waitForChunksToLoad()
    return client
  }
  try {
    const port = await portFree()
    await fs.copyFile(process.env.MBOT_TEST_SERVER_JAR, path.join(root, 'server.jar'))
    await fs.writeFile(path.join(root, 'eula.txt'), 'eula=true\n')
    await fs.writeFile(path.join(root, 'server.properties'), [
      'server-ip=127.0.0.1','server-port='+port,'online-mode=false',
      'spawn-protection=0','difficulty=peaceful','gamemode=survival',
      'level-type=minecraft:flat','max-players=3','view-distance=4','simulation-distance=4',
      'enable-command-block=false','motd=isolated-plugin-candidate'
    ].join('\n') + '\n')
    server = spawn('java',['-Xms256M','-Xmx1024M','-jar','server.jar','nogui'],{cwd:root,stdio:['pipe','pipe','pipe']})
    for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { serverLog += chunk.toString() })
    await waitFor(() => serverLog.includes('Done ('), 85000, 'server start')
    await command('gamerule doMobSpawning false')
    await command('gamerule showDeathMessages true')
    await command('gamerule doDaylightCycle false')
    await command('time set day')
    await command('fill -12 62 -12 12 62 12 stone')
    await command('fill -12 63 -12 12 74 12 air')
    await command('setworldspawn 0 63 0')
    bot = mineflayer.createBot({ host:'127.0.0.1', port, username:'candidate_probe', version:'1.20.1', auth:'offline' })
    bot.on('error', e => errors.push('observer: ' + e.message))
    bot.on('end', reason => { if (!stopped) errors.push('disconnected: ' + reason) })
    const events = []
    if (candidate === 'tps') {
      // Old package is a factory; load AFTER the bot receives time state.
      await waitFor(() => bot.entity && bot.time && Number.isFinite(bot.time.age), 25000, 'time state')
      bot.loadPlugin(require('mineflayer-tps')(mineflayer))
      assert.equal(typeof bot.getTps, 'function')
      const t0 = bot.time.age
      await sleep(3300)
      const t1 = bot.time.age
      const value = bot.getTps()
      record('tps_returns_bounded_number', Number.isInteger(value) && value >= 0 && value <= 20, { tps: value, worldAgeDelta: t1 - t0 })
      record('server_time_advances', t1 > t0, { before:t0, after:t1 })
      // Upstream implementation recursively schedules setTimeout with no stop().
      report.limitations.push('unbounded recurring timer without documented disposal: not safe to load in the main runtime')
      report.integrationRecommendation = 'BLOCKED: timer cleanup required before adoption'
    } else if (candidate === 'death-event') {
      const { deathEventPlugin } = require('mineflayer-death-event')
      bot.loadPlugin(deathEventPlugin())
      bot.on('playerDeath', event => {
        let victim = null, reason = null
        try { victim = event.getVictim()?.name || null; reason = event.getReason() } catch (e) { errors.push('parse: ' + e.message) }
        events.push({ victim, reason })
      })
      await waitFor(() => bot.entity && bot.registry, 25000, 'observer spawn')
      actor = await createActor(port)
      await command('tp candidate_probe 0 63 0')
      await command('tp attacker_probe 4 63 0')
      // Negative control: a server system message MUST NOT mean player death.
      await command('tellraw @a {"text":"candidate non-death control message"}')
      await sleep(1200)
      const beforeKill = [...events]
      record('reject_unrelated_system_messages', beforeKill.length === 0, { falsePositiveEvents: beforeKill })
      await command('kill attacker_probe')
      const match = await waitFor(() => events.find(e => e.victim === 'attacker_probe' && typeof e.reason === 'string' && e.reason.startsWith('death.')), 6500, 'valid death event').catch(() => null)
      record('detect_real_player_death', Boolean(match), { match, observedEvents: events })
      if (beforeKill.length) report.integrationRecommendation = 'BLOCKED: false-positive events on unrelated system messages'
    } else if (candidate === 'bloodhound') {
      bot.loadPlugin(require('mineflayer-bloodhound')(mineflayer))
      assert(bot.bloodhound, 'plugin failed to attach bloodhound')
      bot.on('onCorrelateAttack', (attacker, victim, weapon) => {
        events.push({ attacker:attacker?.username || attacker?.name, victim:victim?.name, attackerId:attacker?.id, victimId:victim?.id, weapon:weapon?.name || null })
      })
      await waitFor(() => bot.entity && bot.registry, 25000, 'observer spawn')
      actor = await createActor(port)
      await command('tp candidate_probe 0 63 0')
      await command('tp attacker_probe 5 63 0')
      await command('summon minecraft:cow 4 63 0 {NoAI:1b,Silent:1b}')
      const cow = await waitFor(() => Object.values(actor.entities).find(e => e.name === 'cow' && e.position.distanceTo(new Vec3(4,63,0)) < 2), 10000, 'cow for actor')
      await waitFor(() => bot.players.attacker_probe?.entity && bot.entities[cow.id], 9000, 'observer sees actor + cow')
      await actor.lookAt(cow.position.offset(0, 0.8, 0), true)
      for (let i = 0; i < 8 && !events.some(e => e.attacker === 'attacker_probe' && e.victimId === cow.id); i++) {
        actor.attack(cow)
        await sleep(650)
      }
      const found = events.find(e => e.attacker === 'attacker_probe' && e.victimId === cow.id)
      record('correlate_real_melee_attacker_to_victim', Boolean(found), { match:found || null, events })
      report.limitations.push('upstream does not support projectile correlation; detection timing is latency-sensitive')
      if (!found) report.integrationRecommendation = 'BLOCKED until correlation passes real 1.20.1 test'
    }
    if (errors.length) record('no_runtime_errors', false, { errors })
    else record('no_runtime_errors', true)
    report.status = report.checks.every(c => c.status === 'PASS') ? 'PASS' : 'FAIL'
  } catch (err) {
    report.error = err.stack || String(err)
    console.error('DIAGNOSTIC_FAILURE', report.error)
    process.exitCode = 1
  } finally {
    stopped = true
    try { if (actor) actor.quit() } catch {}
    try { if (bot) bot.quit() } catch {}
    await sleep(500)
    try {
      if (server && server.exitCode === null) {
        const exited = once(server, 'exit')
        server.stdin.write('stop\n')
        await Promise.race([exited, sleep(12000).then(() => server.kill('SIGKILL'))])
      }
    } catch { if (server) server.kill('SIGKILL') }
    await fs.writeFile(path.join(reports, candidate + '.json'), JSON.stringify(report,null,2)+'\n')
    await fs.writeFile(path.join(reports, candidate + '-server.log'), serverLog)
    await fs.rm(root,{recursive:true,force:true})
    console.log('RESULT',JSON.stringify({plugin:candidate,status:report.status,checks:report.checks,errors:report.error?.split('\n')[0]}))
    // TPS has a recursive setTimeout in upstream with no unsubscribe. The runner
    // is the safety boundary: terminate only this disposable process.
    if (candidate === 'tps') process.exit(process.exitCode || 0)
  }
}
main().catch(error => { console.error(error); process.exitCode=1 })
