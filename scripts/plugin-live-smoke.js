'use strict'

// Integration smoke on an isolated official Minecraft 1.20.1 Java server.
// Each invocation starts its own world, process and single Mineflayer bot.
// Never use this script on an existing server or world.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const { loadPlugins, PLUGINS } = require('../lib/plugins')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const name = process.argv[2]
const known = PLUGINS.map(([key]) => key)
const timeoutMs = 30000

async function until(check, ms = timeoutMs, reason = 'timeout') {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await sleep(100)
  }
  throw new Error(reason)
}

async function freePort() {
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function withDeadline(promise, ms, reason) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(reason)), ms) })
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  assert(known.includes(name), 'usage: node scripts/plugin-live-smoke.js <' + known.join('|') + '>')
  assert.equal(process.env.MBOT_TEST_EULA_ACCEPTED, '1', 'explicit EULA acceptance required')
  assert(process.env.MBOT_TEST_SERVER_JAR, 'official Minecraft 1.20.1 jar path required')
  const jar = path.resolve(process.env.MBOT_TEST_SERVER_JAR)
  await fs.access(jar)
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mbot-plugin-live-'))
  const serverDir = path.join(root, 'server')
  await fs.mkdir(serverDir)
  const reportDir = path.resolve(process.env.MBOT_PLUGIN_EVIDENCE_DIR || 'plugin-live-evidence')
  await fs.mkdir(reportDir, { recursive: true })
  const report = { plugin: name, minecraft: '1.20.1', node: process.version, mode: 'isolated disposable local server', status: 'FAIL', checks: [], limitations: ['single bot and isolated flat arena; not full colony', 'no Forge server; protocol vanilla 1.20.1', 'no sustained load/soak'] }
  const pass = (check, evidence) => {
    report.checks.push({ check, status: 'PASS', evidence })
    console.log('PASS', check, JSON.stringify(evidence))
  }
  const port = await freePort()
  await fs.copyFile(jar, path.join(serverDir, 'server.jar'))
  await fs.writeFile(path.join(serverDir, 'eula.txt'), 'eula=true\n')
  await fs.writeFile(path.join(serverDir, 'server.properties'), [
    'server-ip=127.0.0.1', 'server-port=' + port, 'online-mode=false',
    'spawn-protection=0', 'difficulty=peaceful', 'gamemode=survival',
    'level-type=minecraft:flat', 'view-distance=4', 'simulation-distance=4',
    'max-players=2', 'enable-command-block=false', 'motd=plugin-isolation'
  ].join('\n') + '\n')
  const server = spawn('java', ['-Xms256M', '-Xmx1024M', '-jar', 'server.jar', 'nogui'], { cwd: serverDir, stdio: ['pipe', 'pipe', 'pipe'] })
  let serverLog = ''
  let bot = null
  const botErrors = []
  const ended = { value: false }
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', chunk => { serverLog += chunk.toString() })
  }
  async function command(cmd) {
    assert(server.exitCode === null, 'server exited before command: ' + cmd)
    server.stdin.write(cmd + '\n')
    await sleep(350)
  }
  async function give(item, count = 1) {
    await command('give plugin_probe minecraft:' + item + ' ' + count)
    return until(() => bot.inventory.items().find(x => x.name === item), 8000, 'item not received: ' + item)
  }
  async function spawnCow(x = 3) {
    await command('summon minecraft:cow ' + x + ' 63 0 {NoAI:1b,Silent:1b}')
    return until(() => Object.values(bot.entities).find(e => e.name === 'cow' && e.position.distanceTo(bot.entity.position) < 14), 8000, 'cow not visible')
  }
  try {
    await until(() => serverLog.includes('Done (') || (server.exitCode !== null && (() => { throw new Error('server startup failed') })()), 85000, 'server startup timed out')
    await command('gamerule doMobSpawning false')
    await command('gamerule keepInventory true')
    await command('gamerule doDaylightCycle false')
    await command('time set day')
    await command('fill -10 62 -10 10 62 10 stone')
    await command('fill -10 63 -10 10 75 10 air')
    await command('setworldspawn 0 63 0')
    bot = mineflayer.createBot({ host: '127.0.0.1', port, username: 'plugin_probe', version: '1.20.1', auth: 'offline' })
    bot.on('error', err => { botErrors.push(err.message); console.error('BOT_ERROR', err.message) })
    bot.on('end', reason => { ended.value = true; console.log('BOT_END', reason) })
    bot.loadPlugin(pathfinder)
    const loaded = loadPlugins(bot, { only: name, skip: '', enabled: true, log: msg => console.log(msg) })
    assert.deepEqual(loaded, [name])
    await until(() => bot.entity && bot.inventory && bot.registry, 30000, 'bot did not spawn')
    await withDeadline(bot.waitForChunksToLoad(), 25000, 'chunks did not load')
    await command('tp plugin_probe 0 63 0')
    await until(() => bot.entity.position.distanceTo(new Vec3(0, 63, 0)) < 3, 8000, 'bot not at arena')
    assert(!ended.value, 'bot disconnected during setup')
    pass('connect_spawn', { server: '1.20.1', loaded, position: bot.entity.position })
    bot.pathfinder.setMovements(new Movements(bot))
    if (name === 'tool') {
      assert.equal(typeof bot.tool.equipForBlock, 'function')
      await command('setblock 2 63 0 stone')
      const block = await until(() => bot.blockAt(new Vec3(2, 63, 0))?.name === 'stone' && bot.blockAt(new Vec3(2, 63, 0)), 7000, 'target block missing')
      await give('wooden_pickaxe')
      await give('iron_pickaxe')
      await withDeadline(bot.tool.equipForBlock(block), 10000, 'tool equip timed out')
      assert.equal(bot.heldItem?.name, 'iron_pickaxe', 'best tool was not equipped')
      pass('equip_best_mining_tool', { target: block.name, held: bot.heldItem.name })
    } else if (name === 'collectblock') {
      assert.equal(typeof bot.collectBlock?.collect, 'function')
      await command('setblock 2 63 0 oak_log')
      const target = await until(() => bot.blockAt(new Vec3(2, 63, 0))?.name === 'oak_log' && bot.blockAt(new Vec3(2, 63, 0)), 8000, 'log not placed')
      const before = bot.inventory.items().filter(x => x.name === 'oak_log').reduce((a, b) => a + b.count, 0)
      await withDeadline(bot.collectBlock.collect(target), 24000, 'collectblock did not complete')
      const after = await until(() => bot.inventory.items().filter(x => x.name === 'oak_log').reduce((a, b) => a + b.count, 0) > before && bot.inventory.items().filter(x => x.name === 'oak_log').reduce((a, b) => a + b.count, 0), 6000, 'log not in inventory')
      assert.equal(bot.blockAt(new Vec3(2, 63, 0))?.name, 'air', 'log still in world')
      pass('collect_real_log_and_drop', { before, after, block: 'air' })
    } else if (name === 'pvp' || name === 'custompvp') {
      await give('iron_sword')
      const sword = bot.inventory.items().find(x => x.name === 'iron_sword')
      await bot.equip(sword, 'hand')
      const cow = await spawnCow()
      assert.equal(bot.heldItem?.name, 'iron_sword')
      if (name === 'pvp') {
        assert.equal(typeof bot.pvp?.attack, 'function')
        bot.pvp.attack(cow)
      } else {
        assert.equal(typeof bot.swordpvp?.attack, 'function')
        // Do not start any other combat motor concurrently.
        Promise.resolve(bot.swordpvp.attack(cow)).catch(err => botErrors.push(err.message))
      }
      try {
        await until(() => cow.isValid === false || !bot.entities[cow.id], 22000, 'combat did not eliminate cow')
        assert.equal(botErrors.length, 0, 'plugin emitted errors')
        pass('melee_target_eliminated', { engine: name, target: 'cow', dead: true })
      } finally {
        if (name === 'pvp') bot.pvp?.stop()
        else bot.swordpvp?.stop()
        bot.pathfinder.setGoal(null)
        bot.clearControlStates()
      }
    } else if (name === 'hawkeye') {
      assert.equal(typeof bot.hawkEye?.autoAttack, 'function')
      assert.equal(typeof bot.hawkEye?.stop, 'function')
      await give('bow')
      await give('arrow', 32)
      await bot.equip(bot.inventory.items().find(x => x.name === 'bow'), 'hand')
      const cow = await spawnCow(7)
      const arrowsBefore = bot.inventory.items().filter(x => x.name === 'arrow').reduce((a, b) => a + b.count, 0)
      try {
        bot.hawkEye.autoAttack(cow, 'bow')
        const arrowsAfter = await until(() => {
          const left = bot.inventory.items().filter(x => x.name === 'arrow').reduce((a, b) => a + b.count, 0)
          return left < arrowsBefore ? left : null
        }, 18000, 'hawkeye did not fire a real arrow')
        pass('ranged_projectile_fired', { arrowsBefore, arrowsAfter, target: 'cow' })
      } finally {
        bot.hawkEye.stop()
        bot.deactivateItem()
      }
    }
    assert(!ended.value, 'bot disconnected before test completed')
    assert.deepEqual(botErrors, [], 'unexpected bot errors')
    pass('no_disconnect_or_error', { botErrors })
    report.status = 'PASS'
  } catch (err) {
    report.error = err.stack || String(err)
    console.error('FAIL', name, report.error)
    process.exitCode = 1
  } finally {
    try { if (bot && !ended.value) bot.quit() } catch {}
    await sleep(400)
    try {
      if (server.exitCode === null) {
        const exited = once(server, 'exit')
        server.stdin.write('stop\n')
        await withDeadline(exited, 12000, 'server failed to stop').catch(() => server.kill('SIGKILL'))
      }
    } catch { server.kill('SIGKILL') }
    await fs.writeFile(path.join(reportDir, name + '.json'), JSON.stringify(report, null, 2) + '\n')
    await fs.writeFile(path.join(reportDir, name + '-server.log'), serverLog)
    console.log('RESULT', JSON.stringify({ plugin: name, status: report.status, checks: report.checks.map(x => x.check), error: report.error?.split('\n')[0] }))
    await fs.rm(root, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
