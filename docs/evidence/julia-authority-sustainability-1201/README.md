# Julia-1 com autoridade: comida, noite, equipar sob ameaça e navegação — r4 contra a baseline r3

Baseline oficial (preservada, inalterada): `../julia-authority-real-1201/` (r3). Branch
`experiment/autonomous-player-loop-next` (PR #88), HEAD inicial `260d340`. Mesmo mundo, mesmo spawn (240,63,-110),
mesmas regras (normal, dia/noite, monstros, `keepInventory=false`), um explorador, nenhum item fornecido, a Julia-1
escolhe entre os candidatos do player loop e o executor determinístico executa. Nenhuma regra muda a escolha da Julia.

## Ciclos por problema (reproduzir → causa-raiz → correção mínima → teste de regressão → teste real)
| problema | reprodução real | causa-raiz | correção (commit) | depois, no Minecraft |
|---|---|---|---|---|
| comida (1) | `runs/food-before`: fome 0 por 10 min, 0 candidatos `find_food`, 0 caçadas | `find_food` só com animal a ≤16; o executor caça a 48; sem executor no loop antes de #88 | percepção = executor (48, poupa os últimos salvo fome extrema) (`aced84d`) | `runs/food-after`: `find_food` oferecido 3×, 2 caçadas — ambas falharam |
| comida (2) | as 2 caçadas: galinha a 36 blocos, "fugiu" na hora | `combat.fight` desiste com alvo >24 (GIVE_UP_DIST) | caça aborda o animal (>16) antes de lutar (`362b8fb`) | — |
| comida (3) | contagem no mundo: 0 animais a ≤48 da base, 1 a ≤96, 11 a ≤160 | objetivo de exploração fica a 64 da base | rebanhos vistos viram lembrança `food` (WorldMemory); com fome e nada a 48, rebanho lembrado a ≤160 é comida alcançável; invalida se vazio (`e60e2d6`) | `runs/food-shelter-after3`: lembrou rebanho a 84 blocos, foi, caçou galinha, comeu (fome 0→2) |
| noite (1) | r3: `sleep_or_shelter` sem executor (102×) | — | `sleep_or_shelter` executa `lib/night.spendNight` (cama ≤32 ou buraco tampado) (`aced84d`) | `runs/food-after`: cavou 3 de pedra sem picareta, sem tampa |
| noite (2) | idem | pedra sem picareta não dá bloco | abrigo só onde a tampa é obtível (`362b8fb`) | `runs/food-shelter-after2`: 84× `sleep_or_shelter` forçado falhando na base |
| noite (3) | idem | o loop oferecia abrigo "na base" mesmo sem executor possível | `shelterNearby` explícito do runtime manda (Gauntlet sem o campo mantém a regra antiga) (`e60e2d6`) | — |
| noite (4) | `runs/night-executor-tests.txt` 3–4 | saía do buraco antes da tampa cavada entrar no inventário; tampa recusada com o bot caindo | espera a tampa; retry após pousar (`6cef9bf`) | **2/2 ciclos completos** (cava, tampa, passa a noite, sai) |
| equipar sob ameaça | r3: `SAFETY_PRECEDENCE` 10× | o executor de preparação recusa tudo sob ameaça | o loop equipa a arma carregada direto, confirmado na mão (`aced84d`) | `runs/equip-threat`: zumbi a 9, Julia escolheu equipar, `equip:stone_sword`, servidor confirma na mão |
| regressão própria | `runs/nav-regression-crash`: processo caiu 3× em 15 min (EPIPE, "floating too long", "Timed out") | percepção cara (findFoodSource 1,17 s) a cada snapshot do monitor (250 ms) | busca cara só no snapshot de decisão (`f4c69c3`) | `runs/nav-after`: 15 min, 0 quedas, 37 pernas ok, 0 falhas |
| navegação | r3: 37 timeouts; `ERROR` por troca de dono | troca de dono contada como erro | perna interrompida = cancelamento (`67172d1`) | — |
| achados do r4 | r4: 12 de 12 pernas falhas com chão água/sem chão; abrigo cavado a 5 blocos; `return_base` interrompido = ERROR | alvo com chão desconhecido mantinha y da base (oceano); `goto` resolve sem chegar | prefere direção com chão conhecido; abrigo só cava em cima do buraco; retorno interrompido = cancelado (`d6843ac`, depois do r4) | `runs/nav-post-r4` (30 min): **15 falhas — sem melhora**; 24 min parado num ponto do qual um bot de teste sai em 6 s; não reproduzido em `runs/respawn-stuck` (3 mortes/renascimentos, sem travar) |
Suíte: 569 → **615/615** (cada teste novo vermelho sem a correção).

## Soak r4 (oficial desta etapa) — `runs/r4-final`, código `f4c69c3`, 115,5 min, do zero, sem intervenção
Nenhum reinício (de código ou infraestrutura) do começo ao fim.

| | r3 (baseline) | r4 |
|---|---|---|
| duração / maior período contínuo sem intervenção | 117,8 min / **61 min** | 115,5 min / **115,5 min** |
| decisões / Julia válidas / forçadas | 516 / 158 / 358 | 350 / 84 / 266 |
| fallbacks / inválidas / timeouts da Julia | 0 / 0 / 0 | 0 / 0 / 0 |
| latência Julia (mediana / máx) | 325 / 1476 ms | 376 / 1180 ms |
| mortes (por hora) | 12 (6,1/h) | **28 (14,5/h)** |
| causas | phantom 6, zumbi 3, aranha 1, afogado 1, queda 1 | **esqueleto 13**, phantom 6, afogado 4, zumbi 2, aranha 1, drowned 1, creeper 1 |
| noites completas / sobrevividas sem morrer / mortes de noite | 6 / 0 / 10 | 5 / 0 / **23** |
| comida obtida | **nenhuma** | 5 carne crua, 2 porco cru, 3 carne podre, 1 maçã |
| comida comida (contagem conservadora) | 0 | ≥1 carne |
| crafts | 14 tábuas, 6 picaretas, 5 mesas, 5 espadas | 7 tábuas, 3 picaretas, 1 mesa, 2 espadas |
| coleta | 47 pedregulho, 21 terra, 8 troncos | 29 pedregulho, 4 linha, 4 couro, 3 cascalho, 3 terra, 1 tronco |
| combate | 28 fugas (loop) + 83 fugas / 4 abates (reflexo) | 80 fugas (loop) + 99 fugas / 14 recuos / 5 abates (reflexo) |
| falhas de navegação | 37 | 27 |
| repetições ≥10 ciclos idênticos | 9 (até 77×, `sleep_or_shelter` sem executor) | 2 (15× exploração normal, 10× fuga) |
| WorldMemory | 165 descobertas | 190 descobertas, 89 sugestões, 20 idas a rebanho lembrado, 14 invalidações |

### O que a Julia fez quando pôde escolher (r4)
| candidatos | escolha | n |
|---|---|---|
| return_base, sleep_or_shelter | return_base | **33 de 33** |
| find_food, return_base | return_base | **29 de 29** |
| prepare_combat, continue_objective | continue_objective 7, prepare_combat 1 | 8 |
| continue_objective, return_base | continue_objective 4, return_base 2 | 6 |
| return_base, prepare_combat(, sleep_or_shelter) | prepare_combat | 4 |
| equip_best_weapon, escape_danger / fight_threat, escape_danger | equipar 1 / lutar 1 | 2 |
Com os executores existindo, a Julia **nunca** escolheu abrigo nem comida quando havia `return_base` como alternativa;
toda a comida do r4 veio dos 24 `find_food` em que ele era o único candidato. Isso é preferência da Julia e não foi
"corrigido" por regra.

## Onde a autonomia quebra agora
1. **Noite / espiral de morte (pior que r3).** 23 das 28 mortes foram de noite. Depois de morrer, o explorador renasce
   no spawn, de noite, sem nada: o único candidato é `continue_objective` (26×) — não há volta (já na base), não há
   arma e **não há abrigo possível** num raio de 16 do spawn (pedra/areia/água sem picareta; medido). Esqueletos
   mataram 13 vezes. Possível agravante não medido: a dificuldade local cresce com o tempo habitado no chunk do spawn
   (r4 rodou depois de horas de testes ali).
2. **A Julia evita abrigo e comida** quando pode escolher `return_base` (62 de 62).
3. **Navegação não melhorou de forma consistente**: 27 falhas no r4 (37 no r3); o ajuste pós-r4 não mostrou ganho em
   30 min (15 falhas, dominadas por 24 min parado num ponto que um bot de teste deixa em 6 s — causa não identificada,
   não reproduzida em 3 mortes/renascimentos provocados).
4. O executor de abrigo funciona (2/2 no teste real) mas nunca completou uma noite no soak (1 tentativa, falhou —
   corrigido depois do r4, sem soak novo).

## Classificação: AUTONOMIA PARCIAL
Melhorou: comida obtida (0 → 11 itens; caça a rebanho lembrado), equipar sob ameaça executado, abrigo noturno real
(2/2 isolado), maior período sem intervenção 61 → 115,5 min, zero quedas de processo, zero fallbacks da Julia, menos
loops longos. Piorou: sobrevivência (12 → 28 mortes; 0 noites sem morte nas duas). Não é sustentável.
