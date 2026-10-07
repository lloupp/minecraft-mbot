# Julia-1 com autoridade real no player loop — Minecraft Java 1.20.1

Primeiro teste da Julia-1 **fora do shadow mode**: a escolha dela entre os candidatos do player loop é a que o
executor determinístico executa no mundo real. Branch `experiment/autonomous-player-loop-next` (PR #88), HEAD inicial
`101b155`, final indicado no comentário da PR. Servidor vanilla 1.20.1 (dificuldade normal, ciclo dia/noite e
spawn de monstros ligados, `keepInventory=false`), um explorador, **nenhum item fornecido**: o jogador de teste e o
líder da colônia ficam longe do explorador (não pegam drops), o mundo é natural (floresta mista + pedra exposta +
água em (240,63,-110)), o explorador nasce sem inventário (dados de jogador apagados antes de cada execução).

## Como a autoridade funciona (código)
`MBOT_JULIA_AUTHORITY=1` + `JULIA_PLAYER_LOOP_URL` (desligado = idêntico; teste dedicado). Em
`runExplorePlayerLoop`: estado real → `candidateIntents` → **Julia escolhe** (`lib/julia-authority.js`) →
guardrails (a escolha tem de ser um dos candidatos; `applyIntent` do próprio player loop não pode acusar violação de
segurança) → executor determinístico (preparação, retorno, fuga/luta, comida, exploração) → novo estado → nova
decisão. Candidato único não consulta a Julia (`forced`). Timeout (5 s), sidecar fora, HTTP/resposta malformada,
escolha inválida e disjuntor aberto caem na política determinística com o motivo registrado; cancelamento durante a
consulta aborta a requisição e nada é executado. A intenção autorizada só vale no executor enquanto ainda for
candidata no estado atual. Cada ciclo fica em `julia-authority.jsonl` (`julia_authority_decision` +
`julia_authority_cycle`: estado resumido, candidatos, escolha, validação, ação, resultado, novo estado).
Ownership, defesa por dano, reconnect e cancelamento não mudaram.

## Objetivo e intervenção humana
O planner da colônia só dá `explorar` a exploradores quando o estoque central está sem déficit — com zero recursos
nunca daria. Por isso o **objetivo** "explorar ao redor da base" é reemitido pelo harness (`scripts/jfeed.sh`,
o mesmo `!explorar base 64` de um jogador) sempre que o explorador fica ocioso. Nenhum item, nenhuma escolha:
tudo dentro do loop é Julia (ou o fallback registrado). Intervenções minhas: só reinícios do bot para carregar
correções (registrados em `infra.log`); nenhum reinício de infraestrutura foi necessário no r3.

## Execuções (`runs/`)
| execução | duração | decisões | Julia (válidas) | forçadas | fallbacks | mortes | observação |
|---|---|---|---|---|---|---|---|
| r0 sem bootstrap | 6,6 min | 26 | 4 | 22 | 0 | 1 | nada coletado: executor exige mesa existente (`NEARBY_TABLE_REQUIRED`) |
| r1 depuração | 81 min | 594 | 2 | 592 | 0 | 6 | 5 correções no meio (bot reiniciado a cada uma) |
| r2 depuração | 36 min | 268 | 10 | 258 | 0 | 2 | 2 correções |
| **r3 final** | **118 min** | **516** | **158** | 358 | **0** | **12** | 2 correções; **último trecho 61 min sem nenhuma intervenção** |

r3, trecho final contínuo (23:25:44 → 00:26:56, 61 min, zero intervenções): 262 decisões (95 Julia, 167 forçadas,
0 fallback), 5 mortes, reconstruiu do zero 4 espadas de pedra e 4 picaretas de madeira.

r3 completo (`runs/r3-final/final.json`): latência da Julia mediana 325 ms / p90 395 ms / máx 1476 ms; 0 inválidas,
0 timeouts, 0 erros de sidecar, 1 consulta cancelada (dono novo). Ações físicas (eventos `before_physical_action`):
69 movimentos, 64 escavações, 67 equipar, 37 crafts, 5 colocações de bloco. Crafts: 14 tábuas, 6 picaretas de
madeira, 5 mesas, 5 espadas de pedra, 5 gravetos. Itens que entraram no inventário: 47 pedregulho, 21 terra, 16
gravetos, 8 troncos, 7 picaretas, 6 espadas, 1 arco/flecha/osso (drops de esqueleto). Comida: **nenhuma**.
Combate/fuga: 28 fugas escolhidas no loop + 83 fugas e 4 mortes de mob pelo reflexo de dano. Mortes: 6 phantom,
3 zumbi, 1 aranha, 1 afogado, 1 queda. Reconexões: 2 (reinícios para correção; o explorador voltou sozinho do estado
salvo). WorldMemory: 165 descobertas, 82 destinos de exploração guiados, 7 sugestões de sítio de preparação.

### O que a Julia decidiu (r3)
| candidatos | escolha da Julia | n | determinística | consequência |
|---|---|---|---|---|
| prepare_combat, sleep_or_shelter (noite, na base) | sleep_or_shelter | 102 | prepare_combat | noite passiva desarmado (sem executor de abrigo/cama) |
| equip_best_weapon, escape_danger | equip_best_weapon | 10 | igual | **recusado pelo preflight (SAFETY_PRECEDENCE) — nada acontece** |
| equip_best_weapon, continue_objective | continue_objective | 9 | equip | explora com a espada guardada |
| fight_threat, escape_danger (armado) | escape_danger | 8 | fight_threat | foge em vez de lutar |
| prepare_combat, continue_objective | prepare_combat | 6 (+1 continue) | igual | espada de pedra feita e equipada |
| equip_best_weapon, continue_objective | equip_best_weapon | 6 | igual | equipa |
| return_base, prepare_combat (noite) | prepare_combat | 2 | return_base | arma em vez de voltar — executado (intenção autorizada) |
| find_food, return_base | return_base | 1 | find_food | não caça (a única chance de comida da execução) |
Divergiu da determinística em 127 de 158 decisões (102 delas o `sleep_or_shelter`).

## Bugs achados com a Julia no comando e corrigidos (reproduzir → causa → correção mínima → teste → repetir no jogo)
| # | sintoma no Minecraft | causa-raiz | correção |
|---|---|---|---|
| 1 | r0: zero recursos, Julia sem nenhuma escolha | executor só prepara junto a mesa existente | bootstrap opt-in (`MBOT_PREPARATION_BOOTSTRAP=1`): 3 troncos → mesa colocada ao lado → picareta de madeira |
| 2 | pernas presas 30 s (`caminho demorou demais`) | fix da #78 ausente na branch | porta de 2f79479/74235f6 |
| 3 | preso numa depressão, 9× `No path`, só saía morrendo | `canDig=false` sem blocos | uma nova tentativa da perna podendo cavar |
| 4 | 103 ciclos parado ao lado de uma aranha | `escape_danger`/`fight_threat` sem executor no loop | usam `flee`/`combat.fight` existentes |
| 5 | aranha a 14 blocos de dia: 10 min em fuga | aranha de dia/enderman contavam como ameaça | neutros não provocados >3 blocos ignorados |
| 6 | 76 ciclos `return_base` na base morrendo de fome | `find_food` exigia animal a ≤8 e não tinha executor; na base return_base não muda nada | animais a ≤16; `find_food` → `food.gatherFood`; return_base por fome só fora da base |
| 7 | 83 ciclos `pos.floored is not a function` | ponto da WorldMemory passado a `bot.blockAt` | `Vec3` |
| 8 | 41 `return_base` "ok" sem sair do lugar | `goto` do pathfinder resolve como sucesso com caminho parcial vazio | player loop confere a chegada; escape ou `NOT_ARRIVED` |
| 9 | 27 ciclos `RECIPE_INPUTS_NOT_CONFIRMED` | pathfinder usava o único pedregulho como degrau, etapa cavava de volta | pedregulho fora dos andaimes durante a etapa |
| 10 | 15 timeouts de retorno a 19 blocos da base | primeiro nó era um pulo de parkour impossível, replanejado para sempre | escape sem parkour, acionado também por timeout |
Todos com teste de regressão (vermelho sem a correção); suíte final 601/601.

## Onde a autonomia quebrou (estado final, r3)
1. **Comida — FALHOU.** Em ~2 h nenhum alimento. Raramente há animal a ≤16 blocos neste trecho de mundo; na única
   vez em que `find_food` foi oferecido a Julia escolheu `return_base`. Vida chegou a 0,8 com fome 0.
2. **Noite — FALHOU.** Sem executor de abrigo/cama, `sleep_or_shelter` é ficar parado; a Julia preferiu isso a se
   armar 102 vezes. Sem dormir, phantoms causaram 6 das 12 mortes.
3. **Equipar sob ameaça — lacuna do executor.** `equip_best_weapon` é candidato sob ameaça, mas o preflight da
   preparação recusa qualquer etapa com ameaça presente (`SAFETY_PRECEDENCE`, 10×): a escolha válida não tem efeito.
4. **Decisões raras.** 69 % das decisões do r3 foram candidato único: a Julia só decide nos pontos de bifurcação do
   player loop (armar×continuar, equipar×continuar, lutar×fugir, noite, fome).
5. Pernas de exploração ainda estouram (37 `caminho demorou demais` no r3) — custo de tempo, não trava.

## Classificação: AUTONOMIA PARCIAL
COMPROVADO: a Julia teve autoridade real e contínua (158 decisões válidas, 0 inválidas/timeouts/erros, 127 divergentes
da regra com consequência física), e o explorador, partindo do zero sem itens, coletou, fabricou, se armou, fugiu,
morreu, renasceu e se reconstruiu repetidamente por 61 min sem intervenção. NÃO COMPROVADO: sobrevivência — não
obtém comida, não atravessa noites com segurança, 12 mortes em 2 h. Não testado: mais de um explorador, outros
biomas, Julia em GPU (aqui CPU).
