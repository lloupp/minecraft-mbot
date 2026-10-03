# Guardrail de fome crítica — validação em Minecraft Java 1.20.1

HEAD `128e15d` da branch `experiment/julia-laya-andy-player-loop-v2`.
Julia-1 em shadow mode, **sem autoridade de execução**; Laya/Andy/NanoAndy
desligados; servidor vanilla 1.20.1 descartável. `npm ci`, `npm run check`,
`python -m py_compile scripts/julia-decision-server.py` OK; `npm test`
**419/419** (inclui `test/player-loop-critical-hunger.test.js`).

Regra sob teste (`immediateSafety`): `food ≤ 5`, sem comida no inventário,
`nearby.food`, `foodDistance ≤ 8` e comida mais perto que a base ⇒ `find_food`
único (candidato forçado; a Julia não é consultada).

## Método

Um worker (`explorador_01`), inventário vazio, saúde 20, objetivo `explore`.
Vaca `NoAI`+`Invulnerable` só teleportada (0,9–9,5 blocos) e três zonas de base
(~2–7, ~10, ~57 blocos); food cai de 8 a 0 durante cada passe. **Cada despacho
foi classificado pelos valores medidos** (food, `foodDistance`, `baseDistance`).
O shadow não loga estados de 1 candidato, então um preload de instrumentação
(`probe.js`, fora do repositório, só leitura) registrou estado+candidatos de
**todos** os despachos do runtime real (155); as linhas do shadow e os payloads
enviados ao sidecar (proxy `tee_proxy.py`) dizem se a Julia foi consultada.

## Resultados (155 despachos; 76 linhas do shadow; 76 payloads ao sidecar)

| Cenário (medido) | n | Candidatos | Julia consultada | Escolha da Julia |
|---|---|---|---|---|
| **1** food ≤5, sem comida, comida ≤8 e mais perto que a base (food 0–5; comida 1,1–7,7; base 7,5–57,4) | 33 | `find_food` (33) — **forçado** | **0** | — |
| **2** food 6–8, mesmas condições (comida 0,9–7,8) | 37 | `find_food, return_base` (37) | 37 | `return_base` 37/37 (conf. ≥0,9957) |
| **3** food ≤5, base mais perto que a comida (base 1,9–7,5; comida 6,5–8,0) | 33 | `find_food, return_base` (33) — **não forçado** | 33 | `return_base` 33/33 (conf. ≥0,9973) |
| **4** comida além de 8 blocos | 33 | `return_base` (33), sem `find_food` — **não forçado** | 0 (1 candidato) | — |

- **Integridade do guardrail:** 0 divergências entre "candidatos == [find_food]"
  e a regra recomputada sobre o estado medido; **0** estados forçados chegaram à
  Julia (nenhum payload correspondente); 0 estados multi-candidato sem linha.
- Latência da Julia (cenários 2+3): p50 ≈ 430 / 422 ms, p95 776 / 583 ms.
- Erros 0, timeouts 0, escolhas inválidas 0, escolhas fora da allowlist 0,
  safety violations 0, abandonos 0.
- **Cenário 4 (ressalva):** o `nearby` só enxerga entidades até 8 blocos, então
  comida "além de 8" nunca aparece como `nearby.food=true, foodDistance>8` (o caso
  do teste unitário). No runtime vira `nearby.food=false` e o único candidato é
  `return_base` (a Julia também não é consultada): o guardrail não força
  `find_food`, mas o bot com food ≤8 e vaca a 8,5 blocos só tem "voltar à base".

## Achado novo: o guardrail tem precedência sobre ameaça

Está em `immediateSafety` **antes** do teste de ameaça. Na célula extra (fome
+ zumbi solitário a 7–12 blocos, sem arma, comida perto) 7 de 12 despachos
viraram `[find_food]`; com food 6–8 na mesma cena o conjunto é `[escape_danger]`
(contrafactual recomputado nos 7 estados). A regra de segurança do Gauntlet dá
**0 violações** para `find_food` aí, e hoje isso não afeta nada (shadow, e o
reflexo de combate do runtime é independente), mas com futura autoridade a fome
crítica poderia mandar o bot buscar comida com um hostil por perto. Sugestão
(não implementada): aplicar o guardrail só sem ameaça, ou depois do tratamento
de ameaça.

## Viés da Julia (não é escopo do guardrail, continua)

Onde a Julia é consultada em fome (cenários 2 e 3) escolheu `return_base`
**70/70**, como antes. O guardrail só protege food ≤5 com comida perto e mais
perto que a base; food 6–8 segue com o viés.

## Smoke dos outros cenários (78 despachos: 64 multi-candidato com Julia, 14 únicos)

| Conjunto de candidatos | Antes (712) | Agora |
|---|---|---|
| `fight_threat/escape_danger` (ameaça c/ arma) | fight 253, escape 12 | fight 6, escape 2 |
| `equip_best_weapon/escape_danger` | equip 162, escape 22 | equip 24, escape 2 |
| `prepare_combat/escape_danger` (ameaça s/ arma) | prepare 39 | prepare 6 |
| `prepare_combat/continue_objective` (exploração) | prepare 141 | prepare 6 |
| `gather_materials/continue_objective` | continue 77 | continue 6 |
| `return_base/prepare_combat` (noite, longe da base) | prepare 6 | prepare 6 |
| `prepare_combat/sleep_or_shelter` (noite, na base) | — (novo) | prepare 6 |

Mesma escolha majoritária em todos; nenhum `find_food` forçado com food cheio
(`immediateSafety` só foi `escape_danger` em 1 caso); únicos: `continue_objective`
11, `escape_danger` 3. Erros 0, timeouts 0, inválidas 0, violações 0, abandonos
0. Latência p50 878 / **p95 1903** / máx 2103 ms (n=64). Interrompidas 16,
retomadas 10, `taskLineageId` em 64/64. Impacto no runtime: lag máx do event
loop 1087 ms (194 eventos >200 ms), na faixa das sessões anteriores (com o
preload de instrumentação ligado, que acrescenta um segundo snapshot).

## Critérios

| Critério | Resultado |
|---|---|
| 0 violações | **0** |
| 0 escolhas fora da allowlist | **0** |
| 0 regressões nos cenários anteriores | **0** nas escolhas do smoke; **mas** a precedência sobre ameaça é uma interação nova (acima) |
| Fome crítica próxima protegida pelo guardrail | **Sim** (33/33 forçados, 0 divergências, Julia não consultada) |
| Julia sem autoridade de execução | **Sim** (`executionAuthority: "none"`) |

## Limites

Um worker, vaca artificial, ameaça só com zumbi solitário, amostras do smoke
pequenas (6 por conjunto). Nenhuma autoridade concedida.

## Arquivos

`guard/` (despachos do runtime, linhas do shadow, payloads, journals,
`guard-analysis.json`), `smoke/`, `probe.js`, `hunger_guard.sh`, `smoke.sh`,
`tee_proxy.py`, `guard_analysis.py`.
