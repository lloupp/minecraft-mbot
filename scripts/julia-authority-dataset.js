#!/usr/bin/env node
// Exporta decisões com escolha real (≥2 candidatos) do julia-authority.jsonl como exemplos para retreino/avaliação:
// a entrada que a Julia viu, a escolha (de quem), e o que aconteceu depois no mundo (resultado, vida/fome, itens,
// morte nos minutos seguintes). Não treina nada; só organiza a evidência.
// uso: node scripts/julia-authority-dataset.js <julia-authority.jsonl> [--deaths <arquivo com um epoch (s) por linha>] [--window 300]
const fs = require('fs')

function args(argv) {
  const out = { file: null, deaths: null, window: 300 }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--deaths') out.deaths = argv[++i]
    else if (argv[i] === '--window') out.window = Number(argv[++i])
    else out.file = argv[i]
  }
  return out
}

function gains(before = {}, after = {}) {
  const out = {}
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const delta = Number(after[name] || 0) - Number(before[name] || 0)
    if (delta) out[name] = delta
  }
  return out
}

function examples(rows, deaths = [], windowS = 300) {
  const cycles = rows.filter((r) => r.type === 'julia_authority_cycle').map((r) => r.data || r)
  return cycles.filter((c) => c.juliaInput).map((c) => {
    const t = Date.parse(c.settledAt || c.decidedAt) / 1000
    const d0 = Date.parse(c.decidedAt) / 1000
    return {
      decisionId: c.decisionId,
      input: c.juliaInput,
      choice: c.choice,
      source: c.source,
      deterministicChoice: c.deterministicChoice,
      outcome: {
        action: c.action,
        ok: c.result?.ok ?? null,
        code: c.result?.code || null,
        healthDelta: c.nextState && c.state ? Number(c.nextState.health) - Number(c.state.health) : null,
        foodDelta: c.nextState && c.state ? Number(c.nextState.food) - Number(c.state.food) : null,
        inventoryDelta: gains(c.state?.inventory, c.nextState?.inventory),
        diedDuringAction: deaths.some((x) => x >= d0 && x <= t),
        diedWithinWindow: deaths.some((x) => x >= d0 && x <= t + windowS)
      }
    }
  })
}

if (require.main === module) {
  const opts = args(process.argv.slice(2))
  const rows = fs.readFileSync(opts.file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const deaths = opts.deaths ? fs.readFileSync(opts.deaths, 'utf8').split('\n').filter(Boolean).map(Number) : []
  for (const example of examples(rows, deaths, opts.window)) process.stdout.write(JSON.stringify(example) + '\n')
}

module.exports = { examples }
