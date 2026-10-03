const fs = require('fs')

const fs0 = require('fs')
const food = require('/home/user/minecraft-mbot/lib/food')

const ocd = food.collectDrops
food.collectDrops = async function (bot, center, isCancelled, opts = {}) {
  const lg = (o) => fs0.appendFileSync('/tmp/run/xp.jsonl', JSON.stringify({ t: Date.now(), ev: 'collectDrops', ...o }) + '\n')
  const P = (v) => v && [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]
  const items = () => Object.values(bot.entities).filter(e => e.name === 'item').map(e => ({ n: e.getDroppedItem?.()?.name, p: P(e.position), d: +e.position.distanceTo(center).toFixed(2), valid: e.isValid }))
  lg({ w: bot.username, phase: 'start', center: P(center), bot: P(bot.entity.position), items: items() })
  const r = await ocd.call(this, bot, center, isCancelled, opts)
  lg({ w: bot.username, phase: 'end', bot: P(bot.entity.position), items: items() })
  return r
}
const gat = require('/home/user/minecraft-mbot/lib/gather')
const omb = gat.mineBlocks
gat.mineBlocks = async function (bot, pred, count, isCancelled, opts = {}) {
  const lg = (o) => fs0.appendFileSync('/tmp/run/xp.jsonl', JSON.stringify({ t: Date.now(), ev: 'mineBlocks', ...o }) + '\n')
  const inv = () => bot.inventory.items().map(i => i.name + ':' + i.count).join(',')
  lg({ w: bot.username, phase: 'start', count, inv: inv() })
  const Pq = (v) => v && [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]
  const origCursor = bot.blockAtCursor.bind(bot), origLook = bot.lookAt.bind(bot), origDig = bot.dig.bind(bot)
  if (process.env.XP_TRACE) bot.blockAtCursor = (d) => { const r = origCursor(d); lg({ w: bot.username, phase: 'trace_cursor', hit: r && r.name + '@' + r.position.toString() }); return r }
  if (process.env.XP_TRACE) bot.lookAt = async (v, f) => { lg({ w: bot.username, phase: 'trace_look', at: Pq(v) }); return origLook(v, f) }
  if (process.env.XP_TRACE) bot.dig = async (b, ...a) => { lg({ w: bot.username, phase: 'trace_dig', block: b.name + '@' + b.position.toString() }); const r = await origDig(b, ...a); lg({ w: bot.username, phase: 'trace_dug', block: b.name }); return r }
  const o2 = { ...opts, onAttempt: async (a) => { opts.onAttempt && opts.onAttempt(a); if (a.code === 'TARGET_BLOCKED' && a.targetPosition) {
      try {
        const { Vec3: V3 } = require('/home/user/minecraft-mbot/node_modules/vec3')
        const tp = new V3(a.targetPosition.x, a.targetPosition.y, a.targetPosition.z)
        const nb = {}; for (const [dx, dy, dz] of [[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,-1,0]]) nb[[dx,dy,dz].join(',')] = bot.blockAt(tp.offset(dx, dy, dz))?.name
        const hits = []
        const origin = bot.entity.position
        for (const off of [[0.5,0.5,0.5],[0.5,0.95,0.5],[1.45,0.5,0.5],[-0.45,0.5,0.5],[0.5,0.5,1.45],[0.5,0.5,-0.45]]) {
          await bot.lookAt(tp.offset(...off), true)
          const c = bot.blockAtCursor(5); hits.push({ off, hit: c && (c.name + '@' + c.position.toString()) })
        }
        lg({ w: bot.username, phase: 'blocked_diag', target: tp.toString(), bot: [+origin.x.toFixed(2), +origin.y.toFixed(2), +origin.z.toFixed(2)], dist: +origin.distanceTo(tp).toFixed(2), neighbors: nb, hits, canDig: bot.canDigBlock(bot.blockAt(tp)) })
      } catch (e) { lg({ phase: 'blocked_diag_err', e: String(e) }) }
    }
    lg({ w: bot.username, phase: 'attempt', code: a.code, target: a.targetPosition, nav: a.navigation, delta: a.delta, confirmed: a.itemConfirmed, msg: a.message, invNow: inv() }) } }
  let r
  try { r = await omb.call(this, bot, pred, count, isCancelled, o2) } finally { bot.blockAtCursor = origCursor; bot.lookAt = origLook; bot.dig = origDig }
  lg({ w: bot.username, phase: 'end', mined: r, inv: inv() })
  return r
}
const root = '/home/user/minecraft-mbot'
const { WorkerController } = require(root + '/core/WorkerController')
const out = (o) => fs.appendFileSync('/tmp/run/xp.jsonl', JSON.stringify({ t: Date.now(), ...o }) + '\n')
const pos = (w) => { try { const p = w.bot.entity.position; return [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)] } catch { return null } }
function wrap(name, before, after) {
  const o = WorkerController.prototype[name]
  WorkerController.prototype[name] = function (...a) {
    before && before.call(this, ...a)
    const r = o.apply(this, a)
    if (r && r.then) return r.then((v) => { after && after.call(this, v, ...a); return v }, (e) => { out({ ev: name + '.reject', w: this.name, err: String(e && e.message || e) }); throw e })
    return r
  }
}
wrap('run', function (task) { out({ ev: 'run.start', w: this.name, task: task.type, src: task.__src || 'manual', reason: task.reason, v: this.taskVersion, pos: pos(this) }) },
  function (v, task) { out({ ev: 'run.end', w: this.name, task: task.type, v: this.taskVersion, ok: v && v.ok, code: v && v.code, cancelled: v && v.cancelled, steps: v && v.preparationSteps, pos: pos(this) }) })
wrap('runExplorePlayerLoop', function (task) { out({ ev: 'xpl.start', w: this.name, v: this.taskVersion, pos: pos(this), inv: this.bot.inventory.items().map(i => i.name + ':' + i.count).join(',') }) },
  function (v) { out({ ev: 'xpl.end', w: this.name, v: this.taskVersion, ok: v && v.ok, code: v && v.code, skipped: v && v.preparationSkipped, steps: v && v.preparationSteps, pos: pos(this), inv: this.bot.inventory.items().map(i => i.name + ':' + i.count).join(',') }) })
wrap('runDeterministicPreparation', function (task) { out({ ev: 'prep.start', w: this.name, v: this.taskVersion, intent: task.intent || task.step, pos: pos(this) }) },
  function (v) { out({ ev: 'prep.end', w: this.name, v: this.taskVersion, ok: v && v.ok, code: v && v.code, pos: pos(this) }) })
const oe = WorkerController.prototype.explore
WorkerController.prototype.explore = function (...a) {
  const w = this; const p0 = pos(this); out({ ev: 'explore.start', w: this.name, v: this.taskVersion, pos: p0, sm: process.env.MBOT_STATEMACHINE || '0' })
  for (const d of [2000, 6000]) setTimeout(() => out({ ev: 'explore.pos+' + d, w: w.name, pos: pos(w) }), d)
  return oe.apply(this, a)
}

// ---- ciclo 3: origem da tarefa, chamadas de storage, planner/orchestrator ----
{
  const { ColonyOrchestrator } = require(root + '/core/ColonyOrchestrator')
  const { StorageManager } = require(root + '/core/StorageManager')
  const { DemandPlanner } = require(root + '/core/DemandPlanner')
  const o3 = (o) => fs.appendFileSync('/tmp/run/xp.jsonl', JSON.stringify({ t: Date.now(), ...o }) + '\n')
  const oRunAuto = ColonyOrchestrator.prototype.runAuto
  ColonyOrchestrator.prototype.runAuto = function (worker, controller, task) {
    task.__src = 'orchestrator'
    o3({ ev: 'orch.runAuto', w: worker.name, task: task.type, reason: task.reason, radius: task.radius })
    return oRunAuto.call(this, worker, controller, task)
  }
  const oTick = ColonyOrchestrator.prototype.tick
  ColonyOrchestrator.prototype.tick = async function () {
    const f = this.autoFailures.size ? JSON.stringify([...this.autoFailures]) : null
    const b = [...this.autoBackoff].map(([k, v]) => [k, Math.max(0, v - Date.now())])
    if (this.auto) o3({ ev: 'orch.tick', inflight: [...this.autoInFlight.keys()], backoff: b, fails: f, fresh: this.storage?.snapshotFresh?.(this.stockMaxAgeMs) })
    return oTick.call(this)
  }
  const oBuild = DemandPlanner.prototype.buildPlan
  DemandPlanner.prototype.buildPlan = function (...a) {
    const r = oBuild.apply(this, a)
    o3({ ev: 'planner.plan', plan: r.plan.map((e) => ({ w: e.worker.name, type: e.task.type, reason: e.task.reason })), deficits: r.report.deficits })
    return r
  }
  for (const m of ['withdraw', 'withdrawFirst', 'deposit', 'depositCargo', 'withdrawBestTool', 'withdrawBuildingMaterial', 'summary', 'count']) {
    const orig = StorageManager.prototype[m]
    StorageManager.prototype[m] = function (bot, ...a) {
      o3({ ev: 'storage.' + m, w: bot && bot.username, args: a.map(String).slice(0, 2) })
      return orig.call(this, bot, ...a)
    }
  }
}

// ---- ciclo 4: staging ----
{
  const { ProductionManager } = require(root + '/core/ProductionManager')
  const o4 = (o) => fs.appendFileSync('/tmp/run/xp.jsonl', JSON.stringify({ t: Date.now(), ...o }) + '\n')
  const P4 = (v) => v && [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]
  const ofind = ProductionManager.prototype.findCraftingTable
  ProductionManager.prototype.findCraftingTable = function (bot, d) {
    const r = ofind.call(this, bot, d)
    o4({ ev: 'table.search', maxDistance: d, bot: P4(bot.entity.position), found: r && P4(r.position) })
    return r
  }
  const ost = WorkerController.prototype.tryLocalPreparationStaging
  if (ost) WorkerController.prototype.tryLocalPreparationStaging = async function (c) {
    o4({ ev: 'staging.start', w: this.name, v: this.taskVersion, pos: P4(this.bot.entity.position) })
    const r = await ost.call(this, c)
    o4({ ev: 'staging.end', w: this.name, v: this.taskVersion, ok: r, pos: P4(this.bot.entity.position) })
    return r
  }
  const ogt = WorkerController.prototype.goTo
  WorkerController.prototype.goTo = function (goal, ms) {
    o4({ ev: 'goTo', w: this.name, v: this.taskVersion, goal: [goal.x, goal.y, goal.z, goal.rangeSq !== undefined ? Math.sqrt(goal.rangeSq) : null], from: P4(this.bot.entity.position) })
    return ogt.call(this, goal, ms)
  }
}

// ---- ciclo 5: defend / taskVersion ----
{
  const o5 = (o) => fs.appendFileSync('/tmp/run/xp.jsonl', JSON.stringify({ t: Date.now(), ...o }) + '\n')
  const od = WorkerController.prototype.defend
  WorkerController.prototype.defend = function (attacker) {
    const before = this.taskVersion
    const p = od.call(this, attacker)   // cancel() roda de forma síncrona antes do primeiro await
    o5({ ev: 'defend.start', w: this.name, vBefore: before, vAfter: this.taskVersion, defending: this.defending, state: this.state })
    return p.then((r) => { o5({ ev: 'defend.end', w: this.name, result: r }); return r })
  }
  const osg = WorkerController.prototype.cancel
  WorkerController.prototype.cancel = function (...a) {
    o5({ ev: 'cancel', w: this.name, vBefore: this.taskVersion })
    return osg.apply(this, a)
  }
}

// ---- ciclo 5: allowlist ----
{
  const o6 = (o) => fs.appendFileSync('/tmp/run/xp.jsonl', JSON.stringify({ t: Date.now(), ...o }) + '\n')
  const oa = WorkerController.prototype.nearbyPreparationAllowlist
  WorkerController.prototype.nearbyPreparationAllowlist = function (...a) {
    const r = oa.apply(this, a)
    const pos = this.bot.entity.position
    const by = {}
    for (const t of r) { by[t.name] = by[t.name] || []; by[t.name].push(+Math.hypot(t.x + 0.5 - pos.x, t.y - pos.y, t.z + 0.5 - pos.z).toFixed(1)) }
    const summ = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { n: v.length, min: Math.min(...v), max: Math.max(...v) }]))
    o6({ ev: 'allowlist', w: this.name, args: a, n: r.length, summ, pos: [+pos.x.toFixed(1), +pos.y.toFixed(1), +pos.z.toFixed(1)], radiusEnv: process.env.MBOT_PREPARATION_RADIUS })
    return r
  }
}
