# Resumo de recuperação determinística do `gather` — 1.20.1

HEAD `257de59`, Julia-1 só em shadow (`executionAuthority:"none"`). `npm run check` OK;
`node --test test/gather.test.js test/gather-recovery-summary.test.js` 14/14. Nenhum código alterado;
`alternativeRoute`/`replan_route` intocados.

`!ordem minerador iron_ore 1` na plataforma no céu; `probe-dispatch.jsonl` guarda o resultado de `gatherBlocks` completo.

| Rep | Tentativa 1 | Tentativa seguinte | `recovery` final |
|---|---|---|---|
| 1–3 (alvo flutuante inalcançável + alvo aberto) | `PATH_FAILED`, `candidateCount=2`, `alternateTargetCandidateObserved=true`, `count=1` | `itemConfirmed=true` | `alternateTargetObserved=true`, `alternateTargetRecoveryConfirmed=true` |
| Controle (1 alvo) | sucesso direto, `candidateCount=1`, `observed=false`, `count=0`, `itemConfirmed=true` | — | `alternateTargetObserved=false`, `alternateTargetRecoveryConfirmed=false` |

Todas `ok:true`, `gathered:1` na mesma ordem. Linhas da Julia: 0 erros/inválidas/violações; `alternativeRoute=false`.
