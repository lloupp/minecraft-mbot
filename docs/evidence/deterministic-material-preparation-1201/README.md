# Guardrail acionável e preparação física determinística — Java 1.20.1

Data local: 2026-09-30. PR #78, branch `experiment/julia-laya-andy-player-loop-v2`.
Referência: `180e7c9d87a893f9103cf6f81775ce52c76f7c9d`; execução final com as alterações
deste commit, identificadas em `source-checksums.txt`. **Sem merge/main/autoridade à Julia.**

## Resultado

**22/22 controles reais do guardrail passaram; duas rotas físicas finais passaram.**
Coleta real confirmada → reavaliação → crafting real → espada equipada →
`[continue_objective]`, em dois ciclos por rota, sem segunda coleta ou loop.

| Controle real (2 repetições cada) | Candidatos |
|---|---|
| madeira+pedra | `[gather_materials]` |
| stick carregado+pedra | `[gather_materials]` |
| 2 cobblestones carregados+madeira | `[gather_materials]` |
| somente madeira / somente pedra / somente ferro | `[continue_objective]` |
| ferro+pedra, sem fonte de stick | `[continue_objective]` |
| 1 plank+pedra, sem outra madeira | `[continue_objective]` |
| zombie real a 4 blocos | `[escape_danger]` |
| food=5, sem alimento, cow real detectada a 3 blocos | `[find_food]` |
| cancelamento sinalizado no snapshot | `[stop_task]` |

Todos esses 22 controles foram singletons: 0 chamadas HTTP do shadow e 0 inferências.
As consultas diagnósticas ao sidecar deram HTTP 200, `model_calls=0`; recorder na
entrada do engine confirmou 0 `predict()`. Segurança/progresso dos controles foram
verificados também via `applyIntent`, com 0 safety violations.

### Prova física final (`physical-confirmed/`)

| Rota | Inventário inicial | Falta calculada / coleta confirmada | Conversões e preparação reais | Inventário final |
|---|---|---|---|---|
| stick + pedra | 1 stick, 1 stone_pickaxe equipada | 2 cobblestones; 2 pedras autorizadas quebradas; deltas 0→1→2 | 1 stone_sword craftada e equipada | stone_sword×1, stone_pickaxe×1 |
| cobblestone + madeira | cobblestone×2, sem ferramenta | 1 stick; 1 oak_log autorizada quebrada; delta 0→1 | 1 log→4 planks; 2 planks→4 sticks; 1 stone_sword craftada/equipada | stone_sword×1, oak_planks×2, stick×3 |

Quantidades são os mínimos por receita/batch, não coleta arbitrária. Depois do gather,
`stone_sword` aparece em `craftable` e os candidatos são `[prepare_combat, continue_objective]`,
**sem gather**. A política determinística escolhe preparação; depois de equipar,
os candidatos são `[continue_objective]`. O objetivo explore fica liberado, mas não
é executado automaticamente neste teste.

Nas duas rotas finais: vida 20, 0 ameaça, 0 erros/timeouts/loops, 0 digs fora das
posições autorizadas e 0 violações de segurança observadas no cenário controlado.
Julia observou somente os dois momentos multi-candidato de preparação; 2 respostas
válidas, 0 erros/invalid, ambas `prepare_combat`, sem consumo de suas escolhas pelo executor.
O gather singleton não consulta Julia. `executionAuthority` da Julia permanece `none`.

## Mudança pequena e opt-in

- `lib/forced-preparation.js`: calcula faltas para **stone_sword**, executa um passo
  por chamada e reavalia. `enabled=false` por padrão; nenhum fluxo existente passa
  a chamá-lo automaticamente. Sem parâmetro de escolha/modelo.
- Usa coleta existente `gather.mineBlocks` e `ProductionManager.craftInternal`,
  com confirmação de inventário, tabela viva próxima previamente fornecida,
  produção local sem storage, alvos explicitamente autorizados e sem colocação de blocos.
- Recusa falta de mesa/picareta/alvos, targets duplicados ou ferramenta que não dê
  cobblestone. Lock por bot; sem retry automático. Checa segurança/cancelamento antes
  e depois das operações, com monitor de 250 ms e deadline cooperativo de 20 s.
- `gather.mineBlocks`: opções novas de allowlist de posições e preferência por dig
  direto **somente com alcance físico e raycast confirmados**. Defaults dos callers
  anteriores preservados; confirmação de drops continua obrigatória.
- Guardrail exige pelo menos **2 planks** quando essa é a única fonte de stick;
  uma única plank não satisfaz a receita. Teste real específico e regressão adicionados.
- Fixture mine_iron antiga ganhou um stick: sua pedra+ferro sem fonte de stick
  deixou corretamente de forçar gather no refinamento e fazia o teste inicial falhar.

## Falhas preservadas e limite de navegação

Não foi um ciclo sem falhas: **duas tentativas físicas preliminares deram timeout**,
ambas depois de confirmar apenas 1 cobblestone. Nenhuma anunciou preparação concluída.
Os registros brutos estão na raiz e em `physical-final/`, incluindo `failure.json`.
Os contadores inicializados em `physical.json` dessas tentativas antigas não resumem
a falha; `summary.json` deriva o resultado do `code=TIMEOUT` e da confirmação real.

Na primeira, a coleta tentava navegar até ambos os blocos. A otimização opt-in evitou
a navegação para o primeiro bloco já ao alcance. Na segunda, o raycast para o segundo
continuou bloqueado: após buscar o primeiro drop, o bot ficou aproximadamente em
(0,5;200;2,5), com a mesa em (1;200;1) entre ele e a pedra em (2;200;0).
O fallback pathfinder para contornar esse obstáculo também expirou. **Não foi corrigido
o pathfinder genérico**, e não é possível afirmar apenas destes logs sua causa interna.

O layout controlado foi ajustado colocando a mesa em (-1;200;-1), sem mudar materiais,
quantidades ou posições dos alvos. Isso manteve mesa próxima e visão livre para os
blocos. `physical-clear-sight/` contém duas rotas limpas; `physical-confirmed/` repete
somente a parte física após as últimas verificações de preflight. As três coletas finais
usaram `navigation=visible_in_reach`. Os timeouts anteriores não entram nos zeros finais.

## Testes, ambiente e limitações

Checkout/pull da branch (HEAD de referência confirmado), `npm run check` OK.
Teste player-loop inicialmente 12/13 por fixture incompatível; corrigida antes do runtime.
Suíte focada final **70/70**; `npm test` completo **443/443**; unittest Julia **2/2**.
Logs de check, testes focados, suíte completa e Python incluídos. Sem benchmark longo.

Minecraft vanilla Java **1.20.1**, Java 17.0.20, Mineflayer 4.42.2; mundo isolado
`physical-preparation-world`, plataforma de terra y=199, survival. Estados vêm de
`realStateSnapshot`, inventário/entidades/blocos reais. Mesa e recursos foram preparados
via console; ingredientes iniciais foram dados antes de cada teste. Após o início da
coleta física, os materiais/resultados **não** foram injetados: vieram de dig/pickup/craft.
Julia oficial CPU, mesmo snapshot/runtime do ciclo anterior, somente shadow.
Servidor e sidecar encerrados ao terminar cada sessão.

Esta ponte experimental suporta espada de pedra, fontes diretas de log/planks/stick
e stone/cobblestone. Não faz bootstrap de picareta/mesa, mineração de ferro/smelting,
preparação genérica de outras armas nem exploração autônoma. A plausibilidade do
guardrail não garante ferramenta, bancada, acessibilidade ou drop correto; o preflight
recusa essas lacunas. Outras variantes reconhecidas por `nearby.stone`/wood não foram
comprovadas fisicamente. Teste mine_iron do ciclo anterior era de candidatos, não deste
executor físico; as rotas físicas aqui usaram explore.

Deadline/cancelamento são cooperativos: parar um craft já submetido ao servidor não
é garantido. Monitor não equivale a uma prova de interrupção segura durante cada fase.
Integração com tarefas concorrentes do WorkerController ainda não está implementada;
driver opera um bot ocioso, sem tarefas de fundo. Sem condição de autoridade limitada
para Julia: falta testar interrupções reais durante coleta/crafting, retomada após
falha parcial, obstáculos, proveniência dos alvos, integração/exclusão de tarefas e CI.

Próximo passo: integrar um único passo opt-in ao dispatch determinístico com ownership
da tarefa, testar cancelamento/ameaça durante execução e recusar/recuperar caminhos
obstruídos sem repetir coleta já confirmada. Manter Julia em shadow.

## Evidência/reprodução

`rows.json`: 22 estados/candidatos/consultas de controle. `summary.json`: gates e falhas
históricas. `physical-confirmed/physical.json`: faltas, tarefas, deltas de inventário,
crafting/equip e próximos candidatos por ciclo. Logs, comandos, shadow e payloads brutos
das quatro sessões incluídos, sem apagar tentativas malsucedidas.

Preparar servidor 1.20.1/EULA e runtime Julia conforme o ciclo anterior. Rodar `run.js`
com `ORDER_SERVER_DIR`, `ORDER_PYTHON`, `JULIA_MODEL` e um `ORDER_OUTPUT_DIR` novo.
`PHYSICAL_ONLY=1` repete apenas as duas rotas físicas. `summarize.py` valida os registros
arquivados deste ciclo. Nenhuma ativação no fluxo padrão.
