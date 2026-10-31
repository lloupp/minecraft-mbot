'use strict'

// Reprova um soak real (scripts/tool-api-natural-soak.js) por comportamento,
// não só por exceção: mortes, worker parado com tarefa, nenhum trabalho do
// modo automático, falhas de baú e erros de tipo de posição.
//
// Uso: node scripts/soak-gate.js <pasta-de-evidência>   (lê report.json)
// Limites por execução (control e api-active), ajustáveis por env.

const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_LIMITS = {
  maxDeaths: Number(process.env.MBOT_GATE_MAX_DEATHS ?? 1),
  minAutoResults: Number(process.env.MBOT_GATE_MIN_AUTO_RESULTS ?? 1),
  maxStuckSeconds: Number(process.env.MBOT_GATE_MAX_STUCK_S ?? 240),
  maxStockOpenFailures: Number(process.env.MBOT_GATE_MAX_STOCK_FAILURES ?? 3),
  stuckRadius: 2
}

// Maior intervalo em que um worker com tarefa ficou num raio de `radius` blocos.
function longestStuckSeconds(samples, worker, radius) {
  let anchor = null
  let longest = 0
  for (const sample of samples) {
    const state = sample.workers?.find((w) => w.worker === worker)
    const p = state?.position
    if (!p || !state.currentTask) { anchor = null; continue }
    if (!anchor || Math.hypot(p.x - anchor.x, p.y - anchor.y, p.z - anchor.z) > radius) {
      anchor = { x: p.x, y: p.y, z: p.z, at: sample.elapsedMs }
      continue
    }
    longest = Math.max(longest, (sample.elapsedMs - anchor.at) / 1000)
  }
  return longest
}

function evaluate(report, limits = DEFAULT_LIMITS) {
  const failures = []
  const metrics = []
  if (report.status !== 'PASS') failures.push(`soak não terminou: ${report.status || 'sem status'} ${String(report.error || '').split('\n')[0]}`)
  if (!report.runs?.length) failures.push('nenhuma execução registrada')
  for (const run of report.runs || []) {
    const workers = [...new Set((run.samples || []).flatMap((s) => (s.workers || []).map((w) => w.worker)))]
    const stuck = Math.max(0, ...workers.map((w) => longestStuckSeconds(run.samples || [], w, limits.stuckRadius)))
    const m = {
      run: run.name,
      status: run.status,
      deaths: run.deaths ?? null,
      autoResults: run.autoResults ?? null,
      stockOpenFailures: run.stockOpenFailures ?? null,
      positionTypeErrors: run.positionTypeErrors ?? null,
      minimumHealth: run.minimumHealth ?? null,
      minimumFood: run.minimumFood ?? null,
      longestStuckSeconds: Math.round(stuck)
    }
    metrics.push(m)
    const fail = (text) => failures.push(`${run.name}: ${text}`)
    if (run.status !== 'COMPLETED') fail(`execução ${run.status || 'incompleta'}`)
    if (m.deaths > limits.maxDeaths) fail(`${m.deaths} morte(s) > ${limits.maxDeaths}`)
    if (m.autoResults < limits.minAutoResults) fail(`${m.autoResults} resultado(s) do modo automático < ${limits.minAutoResults}`)
    if (m.stockOpenFailures > limits.maxStockOpenFailures) fail(`${m.stockOpenFailures} falha(s) ao abrir o baú > ${limits.maxStockOpenFailures}`)
    if (m.positionTypeErrors > 0) fail(`${m.positionTypeErrors} erro(s) de tipo de posição`)
    if (stuck > limits.maxStuckSeconds) fail(`worker parado com tarefa por ${m.longestStuckSeconds}s > ${limits.maxStuckSeconds}s`)
  }
  return { ok: failures.length === 0, failures, metrics, limits }
}

if (require.main === module) {
  const dir = process.argv[2]
  if (!dir) {
    console.error('uso: node scripts/soak-gate.js <pasta-de-evidência>')
    process.exit(2)
  }
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'))
  const result = evaluate(report)
  console.log(JSON.stringify(result, null, 2))
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = result.metrics.map((m) => `| ${m.run} | ${m.deaths} | ${m.autoResults} | ${m.longestStuckSeconds}s | ${m.stockOpenFailures} | ${m.minimumHealth} | ${m.minimumFood} |`)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      `### Soak gate: ${result.ok ? 'PASSOU' : 'FALHOU'}`, '',
      '| execução | mortes | resultados auto | maior parada | falhas de baú | vida mín. | fome mín. |',
      '|---|---|---|---|---|---|---|', ...rows, '',
      ...result.failures.map((f) => `- ${f}`), ''
    ].join('\n'))
  }
  process.exit(result.ok ? 0 : 1)
}

module.exports = { evaluate, longestStuckSeconds, DEFAULT_LIMITS }
