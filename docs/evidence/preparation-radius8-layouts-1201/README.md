# Raio de preparação 8 — outros camps naturais e dois exploradores — Minecraft 1.20.1

HEAD do ciclo: `4d04924` (nenhum código do bot foi alterado neste ciclo; `npm run check`/`npm test`: 556/556).
Servidor vanilla 1.20.1 descartável; Julia desligada (`executionAuthority = none`); `MBOT_EXPLORE_PREPARATION=1`,
`MBOT_DETERMINISTIC_PREPARATION=1`, `MBOT_PREPARATION_RADIUS=8`; origem = planner/orquestrador (`!colonia auto on`),
6 rodadas por camp (rodadas pares com um zombie). `scripts/` tem o harness; `failed-and-superseded/` guarda cada
rodada inválida ou descartada e por quê.

Pergunta do ciclo: o raio 8 (opt-in) generaliza além do camp A (6/8 no ciclo anterior)? Dá para discutir ligá-lo por padrão?

## Resultado (harness corrigido, ver §2) — `results/`
| camp | explorador(es) | armados / tentativas | observação |
|---|---|---|---|
| A (ciclo anterior) | 1 | 6/8 | referência |
| B (mesa/árvores noutra disposição) | 1 | **3/6** | 2× `TARGET_BLOCKED` (rodada 1: drop de tronco preso, analisada; rodada 3 não analisada), 1× janela/zombie |
| C2 (árvores a 5,7–7,6 da partida) | 1 | **5/6** | 1 rodada de zombie truncada pela janela |
| A | **2** | **7/12** | rodadas sem zombie: 5/6; zombie: 2/6 (rodada 4: `THREAT`; 6: janela truncada) |
Total neste ciclo: **15/24 (62 %)**. `run.reject` só `caminho demorou demais` (3× em A×2, pernas de exploração do pathfinder); backoff máx. 15 s; staging/ameaça/defesa
funcionaram em todas as rodadas com zombie (`THREAT` → `defend` → re-despacho do planner).
**Conclusão: o raio 8 continua opt-in.** Os 62 % misturam dois fatores que o ciclo isolou (§3) e nenhum é
resolvido por aumentar o raio. Ligar por padrão exigiria resolver o drop em bolsão de folhas, que não resolvi.

## 2. Armadilhas de harness encontradas (todas guardadas em `failed-and-superseded/`) — COMPROVADO
1. `invalid_B1`: o `fill` de reset (31×24×46 = 34 k blocos) passava do limite de 32 768 e **falhava em silêncio**;
   mesa/baú/árvores do camp A ficaram no camp B (`APPROVED_TARGETS_INSUFFICIENT`, estoque no baú errado). Corrigido
   dividindo o `fill` em dois.
2. `C_boundary_trees_8.06`: as árvores do layout C estavam a 8,06 blocos da partida (raio 8): fora do raio. Só
   entravam depois do staging. O bot se comportou **corretamente** (sem busca ilimitada, seguiu explorando); o
   layout é que era um caso-limite. C2 aproxima as árvores (5,7–7,6).
3. `B_ok` / `C2_ok`: `eduardo` e `eduardo_bot` ficavam na partida e **pegavam os drops** do explorador
   (`data get entity … Inventory` mostrou cobblestone neles) → `ITEM_NOT_CONFIRMED` que parecia bug do bot. Agora
   são movidos 50 blocos depois de `!base`/`!estoque`. Isto também pode ter inflado o "resíduo de pickup" medido
   antes — **a atribuição daquele resíduo ao bot não é mais certa**.
4. `invalid_pits__*`: os buracos cavados nas pedras do chão acumulavam entre rodadas (o explorador nascia em y=70
   dentro de um poço); o reset agora preenche y69–71 com `stone replace air`.
5. Após a rodada de dois exploradores o `explorador_02` continuava na colônia (rodada seguinte contaminada) e
   duas baterias minhas rodaram em paralelo: descartadas, só uso execuções sequenciais com um único processo.

## 3. Causa-raiz dos 9/24 restantes — COMPROVADO (geometria) / NÃO RESOLVIDO (correção)
Nos casos de `TARGET_BLOCKED`/`ITEM_NOT_CONFIRMED` com árvore, o log aprovado é de um carvalho pequeno cujas folhas
baixas (y+1) cobrem **as quatro células vizinhas da base**. `scripts/nook5.js` reproduz isolado, com o `Movements`
real do worker (`canDig=false`): 11/14 de pickup; nas 3 falhas o item está numa célula de ar com folha/tronco em
cima e as 4 vizinhas também cobertas → o bot (1,8 m de altura) não entra em nenhuma célula a <1,425 do item
(janela de pickup), fica a ~2 blocos. Os mesmos anéis fecham a visada (`TARGET_BLOCKED`).
Duas correções candidatas foram **testadas e descartadas** (não estão no código):
* cavar a folha acima da célula do drop (`beforeMove` async): 10/14 vs 11/14 sem a opção — sem ganho (só abre a
  célula do item, não as vizinhas de entrada);
* preferir o tronco com menos vizinhas cobertas (`failed-and-superseded/rejected-leafroof-ordering.patch`, com
  teste vermelho→verde): B continuou 3/6 e mandou para o início uma bétula a 7,9 blocos (recusada na hora por
  `requireInReach`, sem caminhar).
Próximo passo plausível (não implementado): derrubar o tronco de cima para baixo ou abrir 1–2 folhas na
entrada do bolsão antes da coleta, medido por `nook5.js` antes de ligar no worker.

## 4. Dois exploradores em terreno natural — COMPROVADO (limitado)
A×2: nenhum conflito de owner (`1 worker = 1 dono físico` mantido; cada um com o seu `taskVersion`),
`sincronizar_estoque` e exploração não colidiram, ambos armaram nas rodadas 2,3,5. Os dois disputam as mesmas
árvores/pedras do camp (esperado); rodada 4 (zombie) os dois ficaram `THREAT`/`APPROVED_TARGETS_INSUFFICIENT`
porque o camp tinha menos alvos que a demanda de dois.

## Classificação
* COMPROVADO: raio 8 generaliza **parcialmente** (B 3/6, C2 5/6, A×2 7/12); causa dos fracassos restantes é
  geometria de folhas (anel) + drop em bolsão; 5 armadilhas de harness; threat/defend/re-despacho sob raio 8.
* PROVÁVEL: parte do "resíduo de pickup" do ciclo anterior era interferência dos bots de teste (§2.3).
* NÃO TESTADO: floresta real não gerada por `place feature`, bioma com neve/água, bétulas altas, 3+ exploradores.
* BLOQUEADO: StateMachine real (plugin indisponível no sandbox), Julia shadow (modelo ausente).
