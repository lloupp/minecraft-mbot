# Preparação de `explorar` dirigida pelo DemandPlanner/ColonyOrchestrator — Minecraft 1.20.1

HEAD inicial do ciclo `0cd38e8` (o HEAD tinha 1 teste quebrado: asserção antiga de
`LOCAL_PRODUCTION_REQUIRED`). Servidor vanilla 1.20.1 descartável, plataforma isolada,
`MBOT_EXPLORE_PREPARATION=1` + `MBOT_DETERMINISTIC_PREPARATION=1`, Julia desligada
(shadow off, `executionAuthority = none`). Instrumentação só de leitura
(`instrumentation-xp.js`): origem da tarefa (`manual` | `orchestrator`), chamadas ao
`StorageManager`, planos do planner, ticks do orquestrador. Linha do tempo bruta:
`timeline-all.jsonl` (inclui tentativas falhas dos dois ciclos).

## 1. Storage configurado + preparação local (manual) — COMPROVADO
Baú de estoque real configurado (`!estoque aqui`) com iscas (cobblestone, sticks, planks,
`stone_sword`, mesa). `explorar` → gather → craft/equip → exploração física, 2 etapas.
`storage.*` = **0 chamadas** (withdraw/withdrawFirst/deposit/summary) durante a preparação,
baú intacto.

## 2. Caminho planner → orchestrator — COMPROVADO
Estoque “estável” no baú (metas críticas = 0) + `!colonia auto on`. Origem registrada:
`planner.plan` → `orch.runAuto` (`src: orchestrator`, `reason: estoque_estavel`) →
`explorar` → gather (tronco→planks→sticks→2 pedras) → craft+equip `stone_sword` →
exploração. Em seguida o orquestrador fez `sincronizar_estoque` (única chamada de storage:
`summary`, fora da preparação) e re-despachou `explorar` já armado com `steps: []`
(sem nova preparação nem craft). O worker segue ciclando (tick 5 s) sem loop de preparação.

## 3. Bugs encontrados e correções
| # | Achado (real) | Correção |
|---|---|---|
| a | Interrupção por ameaça (`PLAYER_LOOP_PREEMPTED`/`THREAT`/cancelado) contava como falha: `fails=1`, backoff 15 s dobrando até 10 min | `runAuto`: interrupção → espera fixa de 5 s, sem escalar `autoFailures` (+teste) |
| b | Explorador desarmado com madeira+pedra mas **sem mesa** ficava parado: `NEARBY_TABLE_REQUIRED` fail-closed → backoff 15/30/60… sem nunca mover | Preflight recusado por falta de condição física (≠ `SAFETY_PRECEDENCE`) cai no `explore` clássico, com `preparationSkipped` (+teste). Reteste: 3 pernas de exploração em 10 s, `fails=null` |
| c | Defesa desloca o bot e o local da preparação se perde (tronco a 3,5 → 5 blocos) | Lembra por 90 s o bloco validado só após `THREAT`; 1 tentativa de voltar (`GoalBlock`) se sem ameaça/desarmado e ≤16 blocos; depois snapshot real e ownership novo. Duas tentativas anteriores falharam por limiar (1,5) e raio (`GoalNear` 1) e estão preservadas (`threat-resume-attempt-before-goalblock.out`) |
| d | `forced-preparation.test.js` com asserção obsoleta no HEAD de referência | atualizada para a recusa física |

## 4. Fluxo autônomo mais longo (final, `threat-resume-final.out`) — COMPROVADO
planner escolhe `explorar` → preparação começa → zombie real → `THREAT` (+1,9 s, dig abortado,
sem ação física depois) → defesa/dia mata o zombie → orquestrador re-despacha sozinho (+15 s)
→ volta ao bloco validado → gather → craft/equip → exploração física → `sincronizar_estoque`
→ nova exploração armada → continua. Sem intervenção humana após `!colonia auto on`.

## 5. Timeout / pickup
56 etapas físicas: as bem-sucedidas levam 12,8–17,5 s (gather completo); limite 20 s não foi
tocado exceto no caso de nova ordem + preparação repetida (`TIMEOUT` 20,1 s). O tempo é de
quebra manual (≈3 s por bloco) e janelas fixas de 3 s de pickup, não de CPU/navegação (lag
máx. 1,3 s). Não alterei o timeout. Falhas `GATHER_ITEM_NOT_CONFIRMED`/`TARGET_BLOCKED`
aparecem principalmente nas execuções **antes** das correções do ciclo anterior; não houve
repetição sistemática nas execuções planner-dirigidas finais. Não comprovado em volume.

## 6. Limites e não testado
Cenário numa plataforma pequena: o pathfinder estoura (`Took to long to decide path`, 25–30 s)
ao tentar alvos fora dela — artefato do harness, tratado como falha com backoff. Não testados:
morte/perda da espada, noite, múltiplos exploradores, `MBOT_STATEMACHINE=1` sob o planner,
mesa/recursos em terreno natural. A janela de 4 blocos continua sendo o gargalo estrutural:
exige mesa + madeira + pedra tão perto (a recusa agora degrada para exploração desarmada).
