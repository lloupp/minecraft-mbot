# Julia-1 shadow mode — validação de cobertura em Minecraft Java 1.20.1

Branch `experiment/julia-laya-andy-player-loop-v2` a partir de `b1eac33`
(contém `nearby` limitado, `taskLineageId`, `repeated_order_streaks`).
Julia-1 (sidecar CPU, 4 núcleos compartilhados, sem GPU) em shadow mode:
**nenhuma autoridade de execução** (`executionAuthority: "none"` em todas as linhas).
Laya, Andy-4 e NanoAndy desligados. Servidor vanilla 1.20.1 descartável
(`online-mode=false`, `keepInventory`, sem spawn de mobs, dia fixo).
Bug do `craftInternal` (issue #79) **não** corrigido aqui; todos os workers
receberam as ferramentas do papel antes de cada ordem.

## Verificações do repositório (em `b1eac33`)

`npm ci`, `npm run check` OK; `npm test` **410/410**; `python -m py_compile
scripts/julia-decision-server.py` OK. Nesta rodada acrescentei ao relatório
`active_hours` e `max_lineage_identical_streak` (+ testes) e atualizei a doc;
suíte final **412/412**.

## Sessão principal (uma execução contínua, 2 h 02 min)

3 laços paralelos (explorador; 2 lenhadores; 2 mineradores; 5 workers) via chat
do dono, com condições montadas pelo console do servidor: ameaça com arma,
ameaça sem arma (com e sem material para preparo), ferro perto sem arma, noite,
interrupção+reemissão, ordens manuais idênticas repetidas, coleta e navegação.
`JULIA_SHADOW_MAX_CONCURRENT=4`.

| Gate | Meta | Resultado |
|---|---|---|
| Decisões | ≥ 500 | **712** (+15 no segmento de fome) |
| Duração | ≥ 2 h | **2,03 h** ativas |
| Safety violations | 0 | **0** |
| Fora da allowlist / escolhas inválidas | 0 | **0 / 0** |
| Abandonos (`stop_task`) / injustificados | 0 | **0 / 0** |
| Loops reais (mesma linhagem, chave estrita) | 0 | **0** (ver ressalva) |
| Disponibilidade | ≥ 98 % | **100 %** (0 descartes) |
| Latência p95 | < 2 s | **1,815 s** (p50 1,20 s · p99 2,27 s · máx 2,63 s) |
| Erros / timeouts | — | **0 / 0** |
| Impacto no runtime | nenhum relevante | ver A/B abaixo |

`npm run julia-shadow:report` (`report-main.json`) devolve
`ready_for_limited_authority: true` com `reasons: []`. **Esse campo só resume os
gates numéricos; não é concessão de autoridade e eu não concedi.** Ressalvas
abaixo pesam mais que o campo.

## Cobertura validada

Multi-candidato: 712/712 decisões têm ≥ 2 candidatos; `taskLineageId` em 712/712
(239 linhagens; 182 com 1 decisão). Conjuntos de candidatos observados:
`fight_threat/escape_danger` 265 · `equip_best_weapon/escape_danger` 184 ·
`prepare_combat/continue_objective` 141 · `gather_materials/continue_objective` 77 ·
`prepare_combat/escape_danger` 39 · `return_base/prepare_combat` 6; fome
(segmento próprio) `find_food/return_base` 12 · `find_food/continue_objective` 1.

| Sinal `nearby` | Positivo | Negativo | Decisões com o sinal (sessão + fome) | Ramo de candidato que ele abriu |
|---|---|---|---|---|
| `wood` | árvore real (floresta) | planície | 152 | `gather_materials/continue_objective` |
| `stone` | camada natural | floresta | 333 | idem |
| `iron` | `iron_ore` colocado (removido depois) | ponto de controle | 22 | `gather_materials/continue_objective` (20) |
| `food` | vaca e melancia | ponto de controle | 24 | `find_food/return_base` (12) |

Sondas manuais isoladas (positivo/negativo): `nearby-probes.jsonl`. Ressalva: na
sonda das 23:19 sobrou um `iron_ore` que eu colocara (limpeza com coordenada
relativa falhou), por isso aparece `iron` junto de `food`; removido com `fill …
replace` e o controle das 23:26 voltou a só `wood`. A contagem da tabela vem dos logs. `nearby` **não usa** `findBlock/findBlocks`:
verificado no código e no perfil de CPU (só `blockAt` e internals abaixo de
`nearbySignals`).

## Retomada, linhagem e ordens repetidas

Interrompidas 522 · retomadas 490 (mesma linhagem). `repeated_order_streaks` = 1.
Maior linhagem: 59 decisões. Sequência idêntica máxima (escolha + candidatos +
objetivo, ignorando números): **7** numa linhagem; com a chave estrita do
relatório, **2** (por isso `loops = 0` — a chave inclui distância da ameaça e
fome, então esse detector praticamente não consegue disparar).
Todas as decisões são de tarefas `coletar_blocos`/`explorar`, exatamente os
tipos que o script despachou por `!ordem`/`!explorar`; não observei despacho
autônomo (o runtime tem outros chamadores de `run()` — `depositar`, `voltar`,
projetos —, que não foram exercitados). As repetições são reemissões minhas.
O "0 loops" é verdadeiro, mas é evidência fraca por si só.

## Impacto no runtime

- **A/B de 15 min, mesmo driver** — lag do event loop (>200 ms): shadow ligado
  454 eventos / >500 ms 131 / >1 s 10 / p99 1050 ms / máx 1220 ms; desligado
  591 / 139 / 7 / 1078 ms / 1220 ms. Sem degradação atribuível ao shadow.
- **Perfil de CPU (shadow ligado, ~18 min):** `nearbySignals` 0,118 s (0,018 %
  do CPU não ocioso), `_observeShadow` 0,205 s (0,03 %). O CPU é do pathfinder
  A* (59 %) e da física; `findBlocks` (80 s) vem de `lib/gather.js` (existente).
- Sessão principal: lag máx 1681 ms (1470 eventos >500 ms, 71 >1 s), em linha
  com a janela desligada; nenhum travamento tipo #79.
- RAM: sidecar Julia 1050→1156 MB; Node 292→704 MB em 2 h (**cresce também com
  o shadow desligado**: 245→578 MB em 15 min — crescimento do runtime, não
  investigado); servidor MC ~1,4 GB.

## Piloto com concorrência 1 (arquivado, `pilot-concurrency1-decisions.jsonl`)

33 decisões + 18 descartes (`max_concurrency`) ⇒ disponibilidade **61 %**;
2 timeouts (1ª inferência após subir o sidecar = cold start de 4 s; outro sob
carga 4,3 s). Por isso a sessão principal usa `MAX_CONCURRENT=4` e o sidecar é
aquecido antes.

## Casos problemáticos e limites (não maquiar)

1. **Fome — julgamento discutível.** Em 12/12 casos `find_food/return_base`
   (food 1–8, vaca a 3 blocos) a Julia escolheu `return_base`; as regras
   escolhem `find_food`. Sem violação, mas com food 1–4 parece pior.
2. **Nunca escolheu `gather_materials`** (0/77); sempre `continue_objective`.
3. **Ações reais raramente concluem:** só 52/712 (7 %) terminaram `ok`
   (522 canceladas por reflexo/reemissão, 138 falhas). A amostra é 69 % sob
   ameaça — sintética e enviesada, não "jogo orgânico".
4. **Falha de rota não coberta:** `alternativeRoute` segue neutro (sem
   evidência do runtime) ⇒ `replan_route` nunca aparece.
5. **Margem de latência estreita:** p95 1,815 s (9 % de folga); mede o cliente
   sob 5 workers + servidor em 4 núcleos compartilhados. Sidecar ocioso:
   150–300 ms.
6. 34 escolhas `escape_danger` onde as regras dariam `equip_best_weapon/
   fight_threat` (`safetyOverride`): seguras; o reflexo determinístico prevalece.
7. O detector de "safety violation" é a regra do Gauntlet V2 aplicada ao
   estado registrado — não observa dano real.

## Conclusão

Os gates **numéricos** foram atingidos nesta configuração e ambiente
(712 decisões, 2,03 h, 0 violações, 0 fora da allowlist, 0 abandonos, 100 % de
disponibilidade, p95 < 2 s, sem impacto detectável no runtime). **Não concedi
autoridade à Julia** e recomendo não conceder ainda: (1) o julgamento na fome
diverge do razoável, (2) falha de rota nunca foi exercida, (3) a sessão é
sintética, com só 7 % de ações concluídas e margem de p95 pequena, (4) o
detector de loop é insensível. Antes de desenhar autoridade limitada: rever a
política de fome, expor evidência real de rota alternativa, repetir com tráfego
orgânico e mais folga de hardware.

## Arquivos

`main-decisions.jsonl`, `hunger-decisions.jsonl`, `pilot-concurrency1-decisions.jsonl`,
`report-main.json`, `report-hunger.json`, `analysis.json` (`analyze.py`),
`lag-main.log`, `rss-main.log`, `journal-*.log`, `ab-on/`, `ab-off/`,
`driver.sh`, `driver_hunger.sh`, `lagmon.js`, `profan.py`.
