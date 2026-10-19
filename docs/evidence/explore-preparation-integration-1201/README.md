# Integração opt-in explorar → preparação determinística — Minecraft Java 1.20.1

Branch `experiment/julia-laya-andy-player-loop-v2` (PR #78), partindo de `14632b5`
(483/483 testes, `npm run check` OK). Correções deste ciclo em `7cd9a89`.
Servidor vanilla 1.20.1 descartável, Mineflayer/WorkerController reais, plataforma
isolada no céu. Flags: `MBOT_EXPLORE_PREPARATION=1` e `MBOT_DETERMINISTIC_PREPARATION=1`.
Julia **não** foi usada (shadow desligado; `executionAuthority = none`).

Fixture (`fixture-fx.sh`): explorador desarmado com `stone_pickaxe` + comida, mesa em
(311,200,-318), coluna de 3 `oak_log` em (310,200..202,-313), 3 `stone` em x=313. Jogador
de teste afastado (o primeiro teste perdeu cobblestone para ele — artefato do harness).
Linha do tempo bruta: `timeline-all-runs.jsonl` (instrumentação `instrumentation-xp.js`,
só leitura/log). `retest-6-runs.out`: 6 execuções após as correções.

## Fluxo real observado (cenário principal)

Uma única tarefa `explorar` (mesmo `taskVersion` em todas as ações): `gather_materials`
(tronco → planks/sticks → 2 stones) → novo snapshot → `prepare_combat` (craft + equip
`stone_sword`) → novo snapshot → `continue_objective` → `explore()` clássico
(`MBOT_STATEMACHINE` desligado) com movimento físico (ex.: x 313,5 → 324,1 → 327,4).
**2 etapas internas**, sem 3º gather e sem 2º craft; limite de 3 etapas foi suficiente.

## Bugs encontrados (reproduzidos no mundo real) e correções mínimas

1. **Mesa nunca em cache** — `explorar` natural terminava em `NEARBY_TABLE_REQUIRED` com a
   mesa a 2,5 blocos: `cachedCraftingTable` só era preenchido pelo harness antigo.
   Correção: antes do preflight, `findCraftingTable(bot, 4)` + `rememberCraftingTable`.
2. **Falso fracasso do gather** — inventário com `cobblestone:2`, mas `collect()` usava o
   contador `mined` (drop pego tarde, durante o alvo seguinte) e lançava `TARGET_BLOCKED`.
   Correção: o ganho real do inventário também confirma o passo (`gained`).
3. **Drop de tronco não recolhido** (`GATHER_ITEM_NOT_CONFIRMED`): item a ~1,5 bloco e
   orçamento de 3 s do `collectDrops` esgotado. Correção opt-in `retryPickup` (2ª passada
   só se o drop ainda existe + até 500 ms para o inventário assentar).
4. **Deslocamento pós-pickup** quebrava a visibilidade validada pelo preflight
   (`TARGET_BLOCKED` nas 3 pedras). Correção opt-in `anchor`: volta à posição validada
   antes de cada tentativa. As opções só são passadas pelo executor de preparação;
   `coletar` clássico não muda.

Antes das correções: ~1 em 4 execuções completava. Depois: **5 de 6** (+ as demais
execuções de teste do ciclo). Falha residual (run 5): drop a 1,3 bloco que o pathfinder não
alcançou em ~1 s (`GATHER_ITEM_NOT_CONFIRMED`) — limitação conhecida de pickup, não mascarada.
Testes: 487/487 (+4: tabela próxima, confirmação por inventário, retryPickup, anchor).

## Nova ordem durante a preparação

`explorar` → `dig oak_log` (taskVersion 9) → nova ordem 0,9 s depois. Última ação física da
v9 em −897 ms; nova ordem em +2 ms; v9 terminou `CANCELLED` em +4 ms; primeira ação física
da v10 em +572 ms (após o drain). Nenhuma ação da v9 depois da ordem. A v10 repetiu a
preparação e estourou `TIMEOUT` (20 s): o passo normal leva ~14 s, com pouca margem.
(Uma tentativa anterior com `!voltar` não despachou tarefa e foi descartada.)

## Ameaça real (zombie)

Zombie invocado a ~9 blocos 1,2 s após o 1º dig: `safety_detected THREAT` em +290 ms,
preparação encerrada, tarefa `THREAT`, **nenhuma ação física depois**, exploração não
retomada; o worker passou à reação de fuga/defesa.

## Cancelamento durante a exploração

Nova ordem 0,9 s após `explore.start`: a nova tarefa começou em +4 ms, a nova exploração
em +51 ms, uma única exploração ativa.

## Regressão com `MBOT_EXPLORE_PREPARATION=0`

`explore.start` 1 ms após `xpl.start`, sem `preparationSteps`, 0 eventos
`[deterministic-preparation]`, bot desarmado explorando (313→327 m).

## Storage (`LOCAL_PRODUCTION_REQUIRED`)

`!estoque aqui` (baú real em 318,200,-314) → `explorar` com as flags → `LOCAL_PRODUCTION_REQUIRED`,
0 etapas, **sem exploração**. A proteção foi mantida. É o maior bloqueio arquitetural: o
modo autônomo/projetos da colônia exigem estoque configurado, então a integração só atuaria
em colônias sem estoque. Além disso, qualquer recusa do preflight é *fail-closed*: a tarefa
`explorar` termina sem explorar (comportamento desenhado, confirmado por teste existente).
Proposta pequena (não implementada): com estoque configurado, permitir apenas o caminho
`localOnly` já existente (craft/gather sem withdraw/deposit) e/o tratar recusa não-segurança
como "explorar sem preparar" — decisão do dono.

## Limites

Cenário sintético numa plataforma; 1 explorador; allowlist ≤4 blocos/≤32 candidatos mantida;
um conjunto pequeno de execuções, não benchmark.
