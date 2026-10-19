# Staging local, pickup em nicho e soak do modo automático — Minecraft 1.20.1

HEAD inicial do ciclo `48cc9b1` (staging local de ≤8 blocos já implementado). Servidor vanilla
1.20.1 descartável, plataforma 181×181 forçada, `MBOT_EXPLORE_PREPARATION=1` +
`MBOT_DETERMINISTIC_PREPARATION=1`, Julia desligada (`executionAuthority = none`). Tarefas
originadas por `planner → orchestrator` (`src: orchestrator`) salvo quando dito `manual`.
`scripts/` tem a instrumentação (só leitura/log) e os harnesses; `timeline-all.jsonl` o bruto;
`invalid-and-superseded/` guarda setups inválidos e execuções anteriores às correções.

## 1. Staging (mesa a 5–8 blocos) — COMPROVADO
Fluxo: planner → `explorar` → preflight recusa a posição inicial → `table.search(8)` acha 1 mesa →
**um** `goTo(GoalNear 1)` (~1,2–1,8 s) → novo snapshot/allowlist/preflight → gather →
prepare_combat → equip → exploração. 1 staging, 2 `table.search`, 0 chamadas de storage durante a
preparação, 1 craft de espada. Reexecutado 4× + soak (9 stagings): sem loop, sem 2ª espada.
- **Controle A (mesa >8):** `table.search(8)=null` → sem movimento → exploração clássica.
- **Controle B (staging não resolve):** recursos do outro lado da mesa → 1 staging, novo preflight
  recusa, **sem 2º staging** → exploração desarmada.
- **Nova ordem durante o staging:** ordem a +0,5 s; staging antigo devolveu `false` e a tarefa antiga
  terminou `CANCELLED` sem nenhuma ação depois; a nova tarefa fez o próprio staging/gather.
- **Ameaça durante o staging:** staging (1,8 s) não é interrompido no meio da caminhada; a ameaça é
  vista logo depois pelo snapshot → `PLAYER_LOOP_PREEMPTED` (espera de 5 s, sem escalar backoff).
- Setups inválidos preservados: recursos fora da janela de 4 blocos (a política escolhe
  `continue_objective`, sem staging); gatilho de teste mais curto que o tick do planner; worker não
  restaurado após reinício; controle B rodado durante backoff de falhas de pathfinder da plataforma pequena.

## 2. Bugs reais deste ciclo
| # | Achado | Causa | Correção |
|---|---|---|---|
| a | Teste do HEAD de referência (`staging`) falhava | recursos a 6 blocos: o snapshot só vê ≤4, política nunca escolhe gather | geometria realista no teste |
| b | `GATHER_ITEM_NOT_CONFIRMED`/`TIMEOUT` pós-staging | **drop de tronco em nicho**: item na célula do tronco removido, sob os troncos restantes (sem altura). `GoalNear(drop,0.5)` gasta ~2,75 s ou resolve sem mover a 1,45–1,51 do item; a janela de coleta é \|Δ\|<1,425 → pickup cara-ou-coroa (**5/6** no harness isolado) | teto de 1,5 s no alvo exato + fallback adjacente (raio 1, com guard `beforeMove`) + empurrão ≤600 ms; harness **12/12**, coleta 3,3 s → 2,05 s |
| c | Após o gather o bot ficava a >4 da mesa → `prepare_combat` recusado | pickups deslocam o bot | volta ao bloco validado antes do passo seguinte (um movimento, com guard) |
| d | Preparação perdida depois de ameaça/defesa/sync | local só era lembrado se a ameaça interrompesse o passo físico | local também lembrado em `PLAYER_LOOP_PREEMPTED` e em `defend()` (desarmado + recursos ao alcance; TTL 90 s; uma volta) |
`nook-before-fix-5of6.out` / `nook-after-fix-12of12.out`: harness determinístico (`scripts/nook.js`).

## 3. Multi-ciclo e soak — COMPROVADO
- 4 min / 28 despachos do planner: 1 staging, 1 espada, backoff 0, 6 syncs só entre tarefas.
- **Soak** (8 rodadas: auto off → reset (desarma, recoloca recursos, tp) → auto on; zombie real em rodadas
  pares; snapshot de estoque renovado antes de cada rodada). Evolução com as correções:

| versão | rodadas completas | com zombie | TIMEOUT | espadas/preparações | backoff máx |
|---|---|---|---|---|---|
| v2 (pré-correções b/d) | 3/8 | 0/4 | 0 | 4/4 | 15,0 s |
| v3 (+site em PREEMPTED) | 3/8 | 0/4 | 1 | 3 (+2 parciais) | 19,5 s |
| v4 (+fallback adjacente) | 6/8 | 2/4 | 1 | 6/7 | 12,1 s |
| v5 (+teto/empurrão) | 7/8 | 3/4 | 0 | 8/8 | 1,9 s |
| v6 (+site em `defend()`) | 8/8* | 4/4 | 0 | 9/9 | 1,9 s |
\*rodada 8 cortada pelo fim da janela logo após o craft. Rodadas v2/v3 também sofreram do sync que
desloca o explorador (resolvido no harness renovando o snapshot, não no código).

## 4. Dois exploradores — COMPROVADO (conflito benigno)
Ownership independente (versões e stagings próprios no mesmo tick). Os dois miraram o mesmo tronco: um
ficou com o item e completou (espada), o outro `GATHER_ITEM_NOT_CONFIRMED` → 1× backoff 15 s →
exploração desarmada. Sem 2ª espada, sem corrupção, sem loop → sem evidência que justifique lock.

## 5. StateMachine — BLOQUEADO (plugin ausente)
`MBOT_STATEMACHINE=1`: `[statemachine] plugin indisponível; usando exploração clássica`; staging +
preparação + fallback clássico funcionaram. A StateMachine real só é coberta pelo workflow
`statemachine-spike` do CI.

## 6. Limites
Plataforma sintética; uma mesa/fixture; janela de 4 blocos e ≤8 do staging continuam o gargalo
estrutural (explorador desarmado sem mesa+recursos próximos segue desarmado); staging não monitora
ameaça durante a caminhada de ~1,8 s; `sincronizar_estoque` desloca o explorador (2 timeouts raros em
102 syncs); defesa do worker com `eduardo_bot` (main) próximo não foi isolada.
