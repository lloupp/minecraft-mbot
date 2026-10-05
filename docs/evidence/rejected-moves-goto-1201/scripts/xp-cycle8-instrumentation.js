// ---- ciclo 8: pernas de exploração / goTo ----
{
  const o8 = (o) => fs.appendFileSync('/tmp/run/xp.jsonl', JSON.stringify({ t: Date.now(), ...o }) + '\n')
  const P8 = (p) => p && [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)]
  const gt = WorkerController.prototype.goTo
  WorkerController.prototype.goTo = async function (goal, ms) {
    const t0 = Date.now(); const from = P8(this.bot.entity.position); const stats = []
    const onUpd = (r) => { if (stats.length < 6) stats.push({ s: r.status, n: r.visitedNodes, ms: Math.round(r.time || 0), len: r.path?.length }) }
    this.bot.on('path_update', onUpd)
    try { const r = await gt.call(this, goal, ms); o8({ ev: 'goTo.end', w: this.name, ok: true, ms: Date.now() - t0, budget: ms, goal: [goal.x, goal.y, goal.z], from, to: P8(this.bot.entity.position), upd: stats }); return r }
    catch (e) { o8({ ev: 'goTo.end', w: this.name, ok: false, err: e.message, ms: Date.now() - t0, budget: ms, goal: [goal.x, goal.y, goal.z], from, to: P8(this.bot.entity.position), upd: stats }); throw e }
    finally { this.bot.removeListener('path_update', onUpd) }
  }
  const sa = WorkerController.prototype.surfaceAt
  WorkerController.prototype.surfaceAt = function (x, z, y) { const r = sa.call(this, x, z, y); o8({ ev: 'surfaceAt', w: this.name, x, z, y, r }); return r }
  const et = WorkerController.prototype.exploreTo
  WorkerController.prototype.exploreTo = function (t, ...a) { o8({ ev: 'exploreTo', w: this.name, target: t, from: P8(this.bot.entity.position), loadedAtTarget: !!this.bot.blockAt(new (require(root + '/node_modules/vec3').Vec3)(t.x, t.y, t.z)) }); return et.call(this, t, ...a) }
}
