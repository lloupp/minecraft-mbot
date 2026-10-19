# Julia shadow (observe-only) — smoke no Minecraft 1.20.1
Runtime real de `feat/julia-shadow-observe-only` com `MBOT_JULIA_SHADOW=1` e um sidecar **stub** (`stubjulia.js`, sempre escolhe o último candidato — de propósito
discordando da política). Resultado: `!ordem lenhadores madeira 4` → `ok:true, gathered:4`, 4× oak_log reais (a execução não muda com o shadow ligado);
`!explorar base 32` (explorador armado) → o stub foi consultado com `equip_best_weapon,continue_objective`, escolheu `continue_objective`, e a tarefa
executada continuou sendo `explorar`; linha `julia_shadow_decision` com `executionAuthority:"none"`, `agreesWithRules:false` (arquivo `julia-shadow.pr3smoke.jsonl`).
Sidecar real (pesos da Julia-1) não foi usado neste smoke; a evidência com o modelo real está nos diretórios `julia-*-1201` desta branch.
