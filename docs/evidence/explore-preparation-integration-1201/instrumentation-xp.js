const fs = require('fs')

const fs0 = require('fs')
const food = require('/home/user/minecraft-mbot/lib/food')

const ocd = food.collectDrops
food.collectDrops = async function (bot, center, isCancelled, opts = {}) {
  const lg = (o) => fs0.appendFileSync('/tmp/run/xp.jsonl', JSON.stringify({ t: Date.now(), ev: 'collectDrops', ...o }) + '\n')
  const P = (v) => v && [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]
  const items = () => Object.values(bot.entities).filter(e => e.name === 'item').map(e => ({ n: e.getDroppedItem?.()?.name, p: P(e.position), d: +e.position.distanceTo(center).toFixed(2), valid: e.isValid }))
  lg({ phase: 'start', center: P(center), bot: P(bot.entity.position), items: items() })
  const r = await ocd.call(this, bot, center, isCancelled, opts)
  lg({ phase: 'end', bot: P(bot.entity.position), items: items() })
  return r
}
const gat = require('/home/user/minecraft-mbot/lib/gather')
const omb = gat.mineBlocks
gat.mineBlocks = async function (bot, pred, count, isCancelled, opts = {}) {
  const lg = (o) => fs0.appendFileSync('/tmp/run/xp.jsonl', JSON.stringify({ t: Date.now(), ev: 'mineBlocks', ...o }) + '\n')
  const inv = () => bot.inventory.items().map(i => i.name + ':' + i.count).join(',')
  lg({ phase: 'start', count, inv: inv() })
  const o2 = { ...opts, onAttempt: (a) => { lg({ phase: 'attempt', code: a.code, target: a.targetPosition, nav: a.navigation, delta: a.delta, confirmed: a.itemConfirmed, msg: a.message, invNow: inv() }); opts.onAttempt && opts.onAttempt(a) } }
  const r = await omb.call(this, bot, pred, count, isCancelled, o2)
  lg({ phase: 'end', mined: r, inv: inv() })
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
wrap('run', function (task) { out({ ev: 'run.start', w: this.name, task: task.type, v: this.taskVersion, pos: pos(this) }) },
  function (v, task) { out({ ev: 'run.end', w: this.name, task: task.type, v: this.taskVersion, ok: v && v.ok, code: v && v.code, cancelled: v && v.cancelled, steps: v && v.preparationSteps, pos: pos(this) }) })
wrap('runExplorePlayerLoop', function (task) { out({ ev: 'xpl.start', w: this.name, v: this.taskVersion, pos: pos(this), inv: this.bot.inventory.items().map(i => i.name + ':' + i.count).join(',') }) },
  function (v) { out({ ev: 'xpl.end', w: this.name, v: this.taskVersion, ok: v && v.ok, code: v && v.code, steps: v && v.preparationSteps, pos: pos(this), inv: this.bot.inventory.items().map(i => i.name + ':' + i.count).join(',') }) })
wrap('runDeterministicPreparation', function (task) { out({ ev: 'prep.start', w: this.name, v: this.taskVersion, intent: task.intent || task.step, pos: pos(this) }) },
  function (v) { out({ ev: 'prep.end', w: this.name, v: this.taskVersion, ok: v && v.ok, code: v && v.code, pos: pos(this) }) })
const oe = WorkerController.prototype.explore
WorkerController.prototype.explore = function (...a) {
  const w = this; const p0 = pos(this); out({ ev: 'explore.start', w: this.name, v: this.taskVersion, pos: p0, sm: process.env.MBOT_STATEMACHINE || '0' })
  for (const d of [2000, 6000]) setTimeout(() => out({ ev: 'explore.pos+' + d, w: w.name, pos: pos(w) }), d)
  return oe.apply(this, a)
}
