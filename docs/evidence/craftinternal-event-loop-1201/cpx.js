// Medição (fora do repo, só leitura/contagem): scans de mesa, duração das tarefas, lag do event loop.
const fs = require('fs')
const root = process.env.MBOT_ROOT || '/home/user/minecraft-mbot'
const OUT = process.env.CPX_OUT || '/tmp/run/cpx.jsonl'
const log = (o) => fs.appendFileSync(OUT, JSON.stringify({ t: Date.now(), ...o }) + '\n')
const { ProductionManager } = require(root + '/core/ProductionManager')
const { WorkerController } = require(root + '/core/WorkerController')
let scanId = 0
const origFind = ProductionManager.prototype.findCraftingTable
ProductionManager.prototype.findCraftingTable = function (bot, ...a) {
  const t0 = process.hrtime.bigint(); const r = origFind.call(this, bot, ...a); const ms = Number(process.hrtime.bigint() - t0) / 1e6
  log({ ev: 'table_scan', n: ++scanId, bot: bot.username, ms: +ms.toFixed(1), found: !!r }); return r
}
if (ProductionManager.prototype.cachedCraftingTable) {
  const oc = ProductionManager.prototype.cachedCraftingTable
  ProductionManager.prototype.cachedCraftingTable = function (bot) { const r = oc.call(this, bot); log({ ev: 'table_cache', bot: bot.username, hit: !!r }); return r }
}
const origRun = WorkerController.prototype.run
WorkerController.prototype.run = function (task) {
  const t0 = Date.now(); const name = this.name
  log({ ev: 'task_start', worker: name, task })
  const p = origRun.call(this, task)
  p.then((v) => log({ ev: 'task_end', worker: name, ms: Date.now() - t0, kind: 'resolved', ok: v && v.ok, code: v && v.code, gathered: v && v.gathered, result: v && { crafted: v.crafted, item: v.item, error: v.error } }),
         (e) => log({ ev: 'task_end', worker: name, ms: Date.now() - t0, kind: 'rejected', error: String(e && e.message || e).slice(0, 200) }))
  return p
}
// lag do event loop
let last = Date.now(), max = 0
setInterval(() => { const n = Date.now(); const d = n - last - 100; last = n; if (d > max) max = d; if (d > 500) log({ ev: 'lag', ms: d }) }, 100).unref()
setInterval(() => log({ ev: 'lag_max', ms: max, rss_mb: Math.round(process.memoryUsage().rss / 1048576) }), 5000).unref()
