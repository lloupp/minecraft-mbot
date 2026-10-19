'use strict'

// Paired, short natural-terrain runtime soak. No existing world is opened.
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const assert = require('node:assert/strict')
const mineflayer = require('mineflayer')
const { Vec3 } = require('vec3')
const repo = path.resolve(__dirname, '..')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function bounded(promise, ms) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer=setTimeout(()=>reject(new Error('phase deadline exceeded')),ms) })]) }
  finally { clearTimeout(timer) }
}
async function waitFor(fn, timeout = 45000) {
  const until = Date.now() + timeout
  while (Date.now() < until) { if (await fn()) return; await sleep(200) }
  throw new Error('natural soak phase timed out')
}
async function freePort() {
  const s = net.createServer().listen(0, '127.0.0.1'); await once(s, 'listening')
  const p = s.address().port; await new Promise(resolve => s.close(resolve)); return p
}
async function manifest(dir) {
  const out = {}
  async function walk(at, relative = '') {
    for (const entry of (await fs.readdir(at, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const key = path.join(relative, entry.name), full = path.join(at, entry.name)
      if (entry.isDirectory()) await walk(full, key)
      else out[key] = crypto.createHash('sha256').update(await fs.readFile(full)).digest('hex')
    }
  }
  await walk(dir); return out
}
async function main() {
  if (!process.env.MBOT_TEST_SERVER_JAR || process.env.MBOT_TEST_EULA_ACCEPTED !== '1') throw new Error('Set MBOT_TEST_SERVER_JAR and MBOT_TEST_EULA_ACCEPTED=1')
  const duration = Number(process.env.MBOT_SOAK_SECONDS || 120)
  assert(Number.isFinite(duration) && duration >= 90 && duration <= 1800)
  const seed = Number(process.env.MBOT_SOAK_SEED || 42)
  assert(Number.isSafeInteger(seed), 'MBOT_SOAK_SEED must be an integer')
  const nightMode = process.env.MBOT_SOAK_NIGHT_MODE || 'accelerated'
  assert(['accelerated', 'natural'].includes(nightMode), 'MBOT_SOAK_NIGHT_MODE must be accelerated or natural')
  // On CI the evidence directory is deterministic for artifact upload; fail
  // rather than deleting a prior experiment if it already exists.
  const dir = process.env.MBOT_SOAK_OUTPUT_DIR
    ? path.resolve(process.env.MBOT_SOAK_OUTPUT_DIR)
    : await fs.mkdtemp(path.join(os.tmpdir(), 'mbot-natural-pair-'))
  if (process.env.MBOT_SOAK_OUTPUT_DIR) await fs.mkdir(dir, { recursive: false })
  const mcPort = await freePort()
  let apiPort = await freePort()
  while (apiPort === mcPort) apiPort = await freePort()
  const serverDir = path.join(dir, 'server'), snapshot = path.join(dir, 'snapshot')
  await fs.mkdir(serverDir)
  await fs.copyFile(process.env.MBOT_TEST_SERVER_JAR, path.join(serverDir, 'server.jar'))
  await fs.writeFile(path.join(serverDir, 'eula.txt'), 'eula=true\n')
  await fs.writeFile(path.join(serverDir, 'server.properties'), `server-ip=127.0.0.1\nserver-port=${mcPort}\nonline-mode=false\nspawn-protection=0\ndifficulty=normal\ngamemode=survival\nlevel-type=minecraft:normal\nlevel-seed=${seed}\nview-distance=5\nsimulation-distance=5\nmax-players=5\n`)
  const report = { minecraft: '1.20.1', seed, nightMode, durationSeconds: duration, node: process.version, dir, setup: [], runs: [], limitations: ['paired soak, not sustained survival proof', 'same initial snapshot; mob timing and network timing are not deterministic', 'one empty chest two blocks from spawn; no food, tools or logs injected', 'API enabled in both arms for identical telemetry; control does not submit API mutations', nightMode === 'accelerated' ? 'night imposed at half duration; no death or threat is forced' : 'natural day/night cycle; short durations may not reach night'] }
  let server, serverLog = '', app, appLog = '', observer, observerEnded = true, observerLog = '', activeRun
  async function command(text) { server.stdin.write(text + '\n'); report.setup.push({ run: activeRun?.name || 'snapshot', command: text }); await sleep(300) }
  async function startServer() {
    serverLog = ''
    server = spawn('java', ['-Xms512M','-Xmx1536M','-jar','server.jar','nogui'], { cwd: serverDir, stdio: ['pipe','pipe','pipe'] })
    server.stdout.on('data', c => { serverLog += c }); server.stderr.on('data', c => { serverLog += c })
    await waitFor(() => { if (server.exitCode != null) throw new Error('server exited'); return serverLog.includes('Done (') }, 90000)
  }
  async function stopServer(label) {
    if (!server) return
    const exited = once(server, 'exit'); server.stdin.write('stop\n')
    try { await bounded(exited,15000) } catch { server.kill('SIGKILL'); await bounded(exited,5000) }
    await fs.writeFile(path.join(dir, `${label}-server.log`), serverLog); server = null
  }
  async function connectObserver() {
    observerLog = ''
    observer = mineflayer.createBot({ host:'127.0.0.1', port:mcPort, version:'1.20.1', username:'soak_owner', auth:'offline' })
    observerEnded=false; observer.on('end',()=>{observerEnded=true})
    observer.on('error', e => { observerLog += e.stack + '\n' }); observer.on('messagestr', s => { observerLog += s + '\n' })
    await waitFor(() => Boolean(observer.entity)); await bounded(observer.waitForChunksToLoad(),30000)
  }
  async function disconnectObserver() {
    if (!observer) return
    if (!observerEnded) { const ended = once(observer, 'end'); observer.quit(); await bounded(ended,5000) }
    observer = null
  }
  const api = async (worker, action, body) => {
    const url = worker ? `/v1/workers/${worker}/${action === 'state' ? 'state' : 'tools/' + action}` : '/v1/workers'
    const response = await fetch(`http://127.0.0.1:${apiPort}${url}`, { signal: AbortSignal.timeout(body ? (duration+30)*1000 : 5000), ...(body ? { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) } : {}) })
    return response.json()
  }
  async function stopApp() {
    if (!app) return
    const exited = once(app, 'exit'); app.kill('SIGTERM')
    let timer
    const [code] = await Promise.race([exited, new Promise((_, reject) => { timer=setTimeout(() => { app.kill('SIGKILL'); reject(new Error('app shutdown timed out')) }, 10000) })]); clearTimeout(timer)
    app = null; assert.equal(code, 0)
  }
  const workers = ['lenhador_01','lenhador_02']
  try {
    await startServer(); await command('gamerule spawnRadius 0'); await command('time set day')
    await connectObserver()
    const logs = observer.findBlocks({ matching: b => b.name.endsWith('_log'), maxDistance:80, count:500 })
    assert(logs.length >= 12, `seed fixture has only ${logs.length} loaded logs`)
    // Select home AND stock as a single natural-terrain fixture. A dark-forest
    // hillside may have zero same-height clear cells exactly two blocks away.
    // Reject that home and inspect another site rather than flattening terrain.
    const chestNear = (origin) => {
      for (let radius = 2; radius <= 6; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue
            for (const dy of [0, -1, 1, -2, 2]) {
              const candidate = { x: origin.x + dx, y: origin.y + dy, z: origin.z + dz }
              const below = observer.blockAt(new Vec3(candidate.x, candidate.y - 1, candidate.z))
              const feet = observer.blockAt(new Vec3(candidate.x, candidate.y, candidate.z))
              const lid = observer.blockAt(new Vec3(candidate.x, candidate.y + 1, candidate.z))
              if (below?.boundingBox !== 'block' || feet?.name !== 'air' || lid?.name !== 'air') continue
              // Keep a walkable approach cell; a clear lid alone cannot
              // establish that the worker can open the container.
              const approach = [[1,0],[-1,0],[0,1],[0,-1]].some(([ax,az]) => {
                const a = observer.blockAt(new Vec3(candidate.x + ax, candidate.y, candidate.z + az))
                const h = observer.blockAt(new Vec3(candidate.x + ax, candidate.y + 1, candidate.z + az))
                const g = observer.blockAt(new Vec3(candidate.x + ax, candidate.y - 1, candidate.z + az))
                return a?.name === 'air' && h?.name === 'air' && g?.boundingBox === 'block'
              })
              if (approach) return candidate
            }
          }
        }
      }
      return null
    }
    let home = null, chest = null
    for (const log of logs) {
      for (const [dx,dz] of [[2,0],[-2,0],[0,2],[0,-2]]) {
        const p=log.offset(dx,0,dz)
        for (let y=log.y+2; y>=log.y-8; y--) {
          const ground=observer.blockAt(new Vec3(p.x,y-1,p.z)), feet=observer.blockAt(new Vec3(p.x,y,p.z)), head=observer.blockAt(new Vec3(p.x,y+1,p.z))
          if (!ground || !['grass_block','dirt','stone'].includes(ground.name) || feet?.name !== 'air' || head?.name !== 'air') continue
          const candidate = { x: p.x, y, z: p.z }
          const stock = chestNear(candidate)
          if (stock) { home = candidate; chest = stock; break }
        }
        if (home) break
      }
      if (home) break
    }
    assert(home && chest, 'no naturally walkable spawn+stock fixture near loaded logs')
    report.chestDistance = Number(Math.hypot(chest.x - home.x, chest.y - home.y, chest.z - home.z).toFixed(3))
    await command(`setworldspawn ${home.x} ${home.y} ${home.z}`)
    await command(`setblock ${chest.x} ${chest.y} ${chest.z} chest`)
    report.home=home; report.chest=chest; report.initialLoadedLogBlocks=logs.length
    await disconnectObserver(); await stopServer('snapshot')
    await fs.cp(path.join(serverDir,'world'), snapshot, { recursive:true })
    const initialManifest=await manifest(snapshot)
    report.snapshotHash=crypto.createHash('sha256').update(JSON.stringify(initialManifest)).digest('hex')
    console.log(`Snapshot ${report.snapshotHash}; home ${JSON.stringify(home)}; ${logs.length} natural logs`)
    for (const name of ['control','api-active']) {
      activeRun={name, samples:[], actions:[], assertions:[]}; report.runs.push(activeRun)
      await fs.rm(path.join(serverDir,'world'), {recursive:true,force:true})
      await fs.cp(snapshot,path.join(serverDir,'world'),{recursive:true})
      assert.deepEqual(await manifest(path.join(serverDir,'world')),initialManifest)
      activeRun.initialSnapshotHash=report.snapshotHash
      const appDir=path.join(dir,name); await fs.mkdir(appDir)
      const stateFile=path.join(appDir,'colony-state.json')
      await fs.writeFile(stateFile,JSON.stringify({version:1,workers:{lenhador:2},home,homeDimension:'overworld',storage:chest,auto:false,companionAuto:false}))
      await startServer(); await connectObserver(); await command('gamemode spectator soak_owner')
      appLog=''
      app=spawn(process.execPath,[path.join(repo,'index.js')],{cwd:appDir,stdio:['ignore','pipe','pipe'],env:{...process.env,
        MINECRAFT_HOST:'127.0.0.1',MINECRAFT_PORT:String(mcPort),MINECRAFT_VERSION:'1.20.1',MINECRAFT_BOT_NAME:'soak_main',MINECRAFT_OWNER:'soak_owner',
        MBOT_TOOL_API:'1',MBOT_TOOL_API_PORT:String(apiPort),MBOT_TASK_CHECKPOINT_FILE:path.join(appDir,'checkpoints.json'),COLONY_STATE_FILE:stateFile,MEMORY_FILE:path.join(appDir,'memory.json'),COLONY_EVENT_LOG:path.join(appDir,'events.jsonl'),
        MBOT_COLONY_AUTOSTART:process.env.MBOT_SOAK_AUTONOMOUS === '1' ? '1' : '0', MBOT_COMPANION_AUTOSTART:'0', MBOT_JULIA_AUTHORITY:'0',MBOT_JULIA_SHADOW:'0',MBOT_LAYA_SHADOW:'0',MBOT_WORLD_MEMORY:'0',MBOT_EXPLORE_PREPARATION:'0',MBOT_DETERMINISTIC_PREPARATION:'0',MBOT_PLUGINS:'0',MBOT_VIEWER_PORT:'0',MBOT_INVENTORY_PORT:'0',MBOT_DASHBOARD:'0',STATUS_SERVER:'0',MINECRAFT_LAN_ANNOUNCE:'0'}})
      app.stdout.on('data',c=>{appLog+=c});app.stderr.on('data',c=>{appLog+=c})
      await waitFor(async()=> { try { return (await api()).length===2 && (await Promise.all(workers.map(w=>api(w,'state')))).every(s=>s.position&&!s.busy&&s.health>0) } catch { return false } })
      const start=Date.now(), pending=[]
      const sample=async()=> {
        const entry={elapsedMs:Date.now()-start,workers:await Promise.all(workers.map(w=>api(w,'state')))}
        activeRun.samples.push(entry)
        await fs.appendFile(path.join(dir,`${name}-samples.jsonl`),JSON.stringify(entry)+'\n')
        if(activeRun.samples.length % 10 === 0) console.log(`${name}: ${Math.round(entry.elapsedMs/1000)}s ${entry.workers.map(w=>`${w.worker} hp=${w.health} food=${w.food} task=${w.currentTask?.type||'idle'}`).join('; ')}`)
      }
      await sample()
      if(name==='api-active') {
        for(const w of workers) pending.push(api(w,'gather',{task_id:`soak-${w}`,args:{resource:'madeira',quantity:64}}).then(result=>{activeRun.actions.push({worker:w,action:'gather',result});return result}).catch(error=>{const result={success:false,error:error.message};activeRun.actions.push({worker:w,action:'gather',result});return result}))
        await waitFor(async()=> (await Promise.all(workers.map(w=>api(w,'state')))).every(s=>s.currentTask?.type==='coletar_blocos'))
        const busy=await api(workers[0],'move_to',{task_id:'busy-probe',args:{position:home}})
        assert.equal(busy.reason,'worker_busy'); activeRun.assertions.push('overlapping mutation rejected')
      }
      if (process.env.MBOT_SOAK_AUTONOMOUS === '1') {
        // A dedicated long-run test must prove that the bot starts on its own:
        // no observer chat command is allowed to enable it.
        await waitFor(() => appLog.includes('[colônia] modo automático ativado no startup'))
        activeRun.assertions.push('colony autostart enabled without owner chat')
      } else {
        observer.chat('!colonia auto on')
        await waitFor(()=>observerLog.includes('Modo automático por demanda: ATIVADO.'))
      }
      if(name==='api-active') {
        // Keep both claims over a scheduler tick before cancelling only one.
        await sleep(6000)
        const beforeStop=await api(workers[1],'state')
        const stopped=await api(workers[0],'stop',{task_id:'stop-first-worker'})
        activeRun.actions.push({worker:workers[0],action:'stop',result:stopped}); assert(stopped.success)
        const afterStop=await api(workers[1],'state')
        assert.equal(afterStop.cancellationRequested,false)
        assert(beforeStop.currentTask?.type==='coletar_blocos' && afterStop.currentTask?.type==='coletar_blocos')
        activeRun.assertions.push('stop cancels first worker without cancelling second')
      }
      let night=false
      while(Date.now()-start<duration*1000) {
        await sample()
        if(nightMode === 'accelerated' && !night && Date.now()-start>=duration*500) { await command('time set night'); night=true }
        if(app.exitCode!=null)throw new Error('runtime exited during soak')
        await sleep(2000)
      }
      observer.chat('!colonia auto off'); await sleep(300)
      if(name==='api-active') { for(const w of workers) await api(w,'stop',{task_id:`final-stop-${w}`}); const results=await Promise.all(pending); assert.equal(results[0].reason,'cancelled') }
      await sample()
      await command(`data get block ${chest.x} ${chest.y} ${chest.z} Items`)
      activeRun.minimumHealth=Math.min(...activeRun.samples.flatMap(s=>s.workers.map(w=>w.health)))
      activeRun.minimumFood=Math.min(...activeRun.samples.flatMap(s=>s.workers.map(w=>w.food)))
      activeRun.deaths=(appLog.match(/\[colônia\] lenhador_\d+ morreu\./g)||[]).length
      activeRun.autoResults=(appLog.match(/\[auto\] lenhador_/g)||[]).length
      activeRun.stockOpenFailures=(appLog.match(/\[estoque\] container_open_failed/g)||[]).length
      activeRun.positionTypeErrors=(appLog.match(/pos\.floored is not a function/g)||[]).length
      activeRun.status='COMPLETED'
      await stopApp(); await disconnectObserver(); await stopServer(name)
      await fs.writeFile(path.join(dir,`${name}-app.log`),appLog)
      await fs.writeFile(path.join(dir,`${name}-observer.log`),observerLog)
      console.log(`${name}: completed ${duration}s; samples ${activeRun.samples.length}; min health ${activeRun.minimumHealth}; min food ${activeRun.minimumFood}; deaths ${activeRun.deaths}; auto results ${activeRun.autoResults}`)
    }
    report.status='PASS'
  } catch(error) { report.status='FAIL'; report.error=error.stack; throw error }
  finally {
    if(app){if(app.exitCode==null && app.signalCode==null){const exited=once(app,'exit');app.kill('SIGKILL');await bounded(exited,5000).catch(()=>{})}await fs.writeFile(path.join(dir,`${activeRun?.name||'failed'}-app.log`),appLog)}
    await disconnectObserver().catch(()=>{});await stopServer(activeRun?.name||'failed').catch(()=>{})
    await fs.writeFile(path.join(dir,'report.json'),JSON.stringify(report,null,2)+'\n')
    console.log(`Evidence: ${dir}`)
  }
}
main().catch(error=>{console.error(error);process.exitCode=1})
