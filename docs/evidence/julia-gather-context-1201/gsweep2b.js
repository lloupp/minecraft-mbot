// Varredura offline: payload real (estado de um despacho real) com descrição regenerada por candidateIntents().
const fs = require('fs')
const { candidateIntents } = require('/home/user/minecraft-mbot/lib/player-loop')
const P = fs.readFileSync('/tmp/run/julia-payloads.jsonl', 'utf8').trim().split('\n').map(JSON.parse)
  .filter(p => p.request && new Set(p.request.candidates.map(c => c.id)).size === 2 && p.request.candidates.every(c => ['gather_materials', 'continue_objective'].includes(c.id)))
const tpl = {}
for (const p of P) tpl[p.request.state.objective.type] ||= p.request.state
async function call(state, candidates) {
  const t0 = Date.now()
  const r = await fetch('http://127.0.0.1:8768/choose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, candidates }) })
  const j = await r.json(); j.ms = Date.now() - t0; j.http = r.status; return j
}
const subsets = [['wood'], ['wood', 'stone'], ['stone', 'iron']]
const dists = [1, 2, 4, 6]
const orders = [['gather_materials', 'continue_objective'], ['continue_objective', 'gather_materials']]
;(async () => {
  const rows = []
  for (const [obj, base] of Object.entries(tpl)) for (const av of subsets) for (const d of dists) for (const o of orders) {
    const s = JSON.parse(JSON.stringify(base))
    for (const k of ['wood', 'stone', 'iron']) { s.nearby[k] = av.includes(k); s.nearby[k + 'Distance'] = av.includes(k) ? d : null }
    const byId = Object.fromEntries(candidateIntents(s).map(c => [c.id, c]))
    if (!byId.gather_materials || !byId.continue_objective) { rows.push({ obj, avail: av.join('+'), d, order: o[0], error: 'candidates=' + Object.keys(byId) }); continue }
    const cands = o.map(i => byId[i]); const r = await call(s, cands)
    if (r.http !== 200) { rows.push({ obj, avail: av.join('+'), d, order: o[0], invalid: r.detail || r.error, http: r.http }); continue }
    rows.push({ obj, avail: av.join('+'), d, order: o[0], gather_desc: byId.gather_materials.description.split('Observed')[1] || '', choice: r.choice, p_gather: r.probabilities?.gather_materials, conf: r.confidence, ms: r.ms })
  }
  fs.writeFileSync('/tmp/run/gsweep2b.json', JSON.stringify({ templates: tpl, rows }, null, 1))
  const sm = rs => ({ n: rs.length, gather: rs.filter(x => x.choice === 'gather_materials').length, p_min: (rs.length ? Math.min(...rs.map(x => x.p_gather)) : null), p_max: (rs.length ? Math.max(...rs.map(x => x.p_gather)) : null) })
  const out = {}
  for (const obj of Object.keys(tpl)) {
    const R = rows.filter(r => r.obj === obj && !r.error && !r.invalid)
    out[obj] = { all: sm(R), by_distance: Object.fromEntries(dists.map(d => [d, sm(R.filter(r => r.d === d))])), by_avail: Object.fromEntries(subsets.map(a => [a.join('+'), sm(R.filter(r => r.avail === a.join('+')))])), by_order: Object.fromEntries(orders.map(o => ['first=' + o[0], sm(R.filter(r => r.order === o[0]))])), errors: rows.filter(r => r.obj === obj && r.error).length, invalid_http400: rows.filter(r => r.obj === obj && r.invalid).length, invalid_by_avail: Object.fromEntries(subsets.map(a => [a.join('+'), rows.filter(r => r.obj === obj && r.invalid && r.avail === a.join('+')).length])) }
  }
  fs.writeFileSync('/tmp/run/gsweep2b-summary.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1))
})()
