# Experimento: autonomia do player loop (branch `experiment/autonomous-player-loop-next`)

Branch limpa baseada na `main`. Herda da antiga PR #78 (`experiment/julia-laya-andy-player-loop-v2`, arquivada na tag
`archive/pr-78-julia-laya-andy-player-loop-v2`) **somente o que continua experimental**. Tudo abaixo é **opt-in e desligado por padrão**.
`executionAuthority = none`: a Julia (e qualquer modelo) só observa; nenhuma escolha de modelo chega ao executor.

## Já promovido para a `main` (não está mais neste delta)
| PR | Conteúdo |
|---|---|
| #84 | Estabilidade do runtime: backoff por interrupção, `collectDrops` (fallback/nudge seguro), cancelamento preserva item entregue |
| #85 | Guardrails determinísticos do player loop + runner pareado do Gauntlet V2 |
| #86 | Julia-1 shadow (observe-only) |
| #87 | Adaptadores de benchmark Andy-4 / NanoAndy |
Antes da #78: #72, #73, #74, #81, #83.

## Ainda experimental (este branch)
| Frente | Arquivos | Flag |
|---|---|---|
| Preparação determinística (arma: mesa → craft → equip), preflight físico, TOCTOU, progresso parcial | `lib/forced-preparation.js`, `core/ProductionManager.js` (`execution.localOnly`), `WorkerController.runDeterministicPreparation` | `MBOT_DETERMINISTIC_PREPARATION=1` |
| Ponte explore → preparation → explore, staging local, retorno ao sítio, noite/respawn, exploração ciente do terreno | `WorkerController.runExplorePlayerLoop` e auxiliares | `MBOT_EXPLORE_PREPARATION=1` |
| Raio local de preparação, caminhada única, folhas | `preparationRadius()`, opt-ins de `lib/gather.js` (`allowedPositions`, `requireInReach`, `clearLeaves`, `retryPickup`, `anchor`) | `MBOT_PREPARATION_RADIUS` (padrão 4, máx. 8) |
| Evidência de alvo alternativo / recuperação de gather | `gather.js` (campos de evidência), `summarizeGatherRecovery` | — |
| Recuperação de drop com guarda de ownership | `collectDrops({ beforeMove })` | usado só pelo executor experimental |
| **WorldMemory** (memória espacial persistente) | `lib/world-memory.js`, `lib/world-observer.js`, `docs/WORLD_MEMORY.md` | `MBOT_WORLD_MEMORY=1`, `MBOT_WORLD_MEMORY_GUIDE=1` |
| Helper sem consumidor | `lib/parallel-shadow.js` | — |

## Evidências (`docs/evidence/`)
Cada pasta tem README. Logs brutos grandes (>60 KB) foram omitidos daqui e listados em `OMITTED.txt`; ficam preservados na tag de arquivo e na
branch antiga. Pastas `julia-*` mantêm só o README (experimentos de modelo; o código já está na `main`).
`world-memory-1201/` documenta descoberta → restart real → reuso por outro worker → confirmação; invalidação sem loop; comparação de exploração
com/sem memória após restart; e `failed-and-superseded/` (inclui o bug do chunk-alvo nunca visitado).
