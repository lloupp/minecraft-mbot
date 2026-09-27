# P0 — coleta física em Forge 1.20.1

Base: main `0418a50c751dac83f68bed16275c916613ecc640` (PR #62 mesclada), branch `fix/collection-p0-inventory-verification`. Gate de navegação aprovado anteriormente e três ciclos de containers aprovados permanecem preservados em `.data/forge-p0/containers/`; não foram repetidos como gate nesta PR.

## Bugs reproduzidos e correção

1. `mineBlocks` comparava a soma de **todos** os itens. Em `baseline-no-drop`, pedra quebrada à mão e remoção confirmada pelo bot observador, cobblestone sem delta, reposição física de uma tábua previamente depositada no baú durante a execução: runtime original retornou `ok=true`, `gathered=1`. O mesmo caso na branch retornou `ITEM_NOT_CONFIRMED`, `ok=false`, delta de cobblestone zero. A reposição controlada não é um drop da pedra; demonstra que um item alheio não pode confirmar essa coleta. A observação inicial `before` também registrou oak_log sem delta, oak_planks adquiridos e falso sucesso; a origem das tábuas dessa observação não foi atribuída.
2. `gatherBlocks` usava `gathered > 0`. Em `baseline-controlled`, pedido de 2 toras com somente 1 adquirida retornou sucesso. Reteste em `negative-approved-inventory-preparation-failed`: delta 1, pedido 2, `ok=false`.

Confirmação agora filtra itens pelos drops do registry (stone → cobblestone, minérios → itens correspondentes), considerando Silk Touch da ferramenta escolhida. Pickup tem prazo de 3 s, filtra o item esperado e termina ao confirmar delta. O worker exige a quantidade inteira e não retorna sucesso nem inicia depósito após cancelamento. Revalida existência e alcance físico antes de dig. API numérica de `mineBlocks`, plugin opt-in e memória de recursos inalcançáveis mantidos.

Códigos centralizados: RESOURCE_NOT_FOUND, RESOURCE_UNREACHABLE, PATH_FAILED, DIG_FAILED, ITEM_NOT_CONFIRMED, INVENTORY_FULL, CANCELLED. Evidência transitória no resultado, no máximo 20 tentativas: posição, bloco, itens esperados, inventário antes/depois, delta e resultado. Não é checkpoint.

## Ambiente e fixture declarada

Minecraft Java 1.20.1, Forge 47.4.10, `127.0.0.1:25586`, survival, EduardoBot e dois workers, sem OP. Nenhum Creative ou `/give`. Fixture pequena: `setblock ... keep` somente em ar, neve fina removida pelo bot em survival, posições/commands registrados. Área principal: madeira perto de (42,63,2), pedra perto de (42,63,-8); os alvos ficam aproximadamente 10 m separados. Fixture inacessível: uma tora suspensa em (45,83,2), sem torre ou terreno aberto automaticamente.

Picareta de madeira fabricada e entregue via estoque em survival; mesa colocada de inventário real em (32,63,-8). Material inicial vem da fixture de estoque já declarada no gate anterior. Coleta roda sem auto-depósito para conservar a prova no inventário. O observador fica afastado dos drops durante as rodadas normais.

A busca do harness usa `findBlocks` real, com predicado de posição dentro de `useExtraInfo` para delimitar a fixture antes de limitar resultados. Não simula navegação, dig, drops ou inventários. Uma versão inicial filtrava após a lista truncada e alguns negativos não chegaram a dig: esses casos **não** são prova dos respectivos cenários. Foram repetidos corretamente. O predicado não altera o runtime de produção.

O contador isolado por bot confirma aquisição do item, mas não identifica por si só a origem de drops do mesmo tipo misturados no mesmo local. Por isso as rodadas registram `playerCollect` com ID do próprio worker, item e posição, além do bloco final visto pelo observador. Os dois alvos independentes e itens diferentes permitem atribuição física nessas rodadas; isso não prova concorrência sobre o mesmo bloco.

## Rodadas normais finais antes da PR

Três rodadas, dois workers simultâneos em cada uma, **6/6 tarefas aprovadas**. Cada tarefa: delta 1, `ok=true`, `verified=true`, pickup do worker correto, bloco final `air` também no observador.

| Rodada | lenhador: oak_log antes/depois | minerador: cobblestone antes/depois | Tempo lenhador/minerador (s) | Vida/fome lenhador / minerador | Resultado |
| --- | --- | --- | --- | --- | --- |
| 1 | 4 → 5 | 0 → 1 | 6.340 / 4.151 | 20/14 / 20/20 | PASS |
| 2 | 5 → 6 | 1 → 2 | 6.141 / 4.053 | 20/14 / 20/19 | PASS |
| 3 | 6 → 7 | 2 → 3 | 6.177 / 4.086 | 20/13 / 20/19 | PASS |

Foram adquiridos 3 oak_log e 3 cobblestone nessas rodadas. Outras cinco rodadas preliminares normais bem-sucedidas estão preservadas em `.data/forge-p0/collection/after*.json`; não substituem as três rodadas finais. Uma sessão preliminar falhou preparando neve/fixture, foi preservada e não foi convertida em PASS.

## Negativos e capacidade

- Recurso já ausente: RESOURCE_NOT_FOUND, nenhum dig, delta zero.
- Tora suspensa inacessível: PATH_FAILED após prazo limitado de cerca de 20 s, nenhum dig, delta zero.
- Cancelamento durante dig: CANCELLED, dig iniciado, tora permaneceu, delta zero.
- Pedra quebrada à mão: bloco final air no observador, delta cobblestone zero, ITEM_NOT_CONFIRMED. Não é sucesso por dig resolvido.
- Pedido parcial: 1/2 toras, sem sucesso falso.
- 35 slots ocupados: NBT do servidor confirma 35 stacks; aquisição de birch_log 0 → 1 preenche o último slot, sucesso. Com 36 slots, spruce_log recusado com INVENTORY_FULL, sem dig. Apenas materiais físicos existentes, repartidos em slots via cliques normais e depois consolidados.
- Cancelamento concorrente: lenhador CANCELLED, delta zero; minerador mantém navegação/dig próprios e adquire 1 cobblestone com sucesso.

A sessão dos cinco primeiros negativos parou na preparação de capacidade por falta de itens; seu `report.ok=false` e erro permanecem em results.json. Os cinco negativos são verificados por seus resultados individuais. Capacidade foi retestada separadamente com `report.ok=true`. Tentativas adicionais de preparação permanecem nos arquivos brutos; não são sucesso de runtime.

Nenhum falso positivo nos casos finais corrigidos. Nenhum stuck ou conflito de pathfinder observado nas coletas normais; a falha de caminho suspenso é intencional. CPU do processo Node (inclui consultas diagnósticas do harness, não só coleta de produção): 50.63% de um core durante 32.58 s, incluindo inicialização, preparação, busca restrita da fixture e deslocamentos; máximo RSS 225.65 MiB. **Amostra curta, não teste prolongado de CPU/memória**. Fome do lenhador chegou a 13, vida 20: não se declara 20/20 para todos os bots. Equipamento, comida e sobrevivência precisam continuar no P0.

## Regressões e review

10 testes adicionados: item certo vs alheio, cancelamento após dig, desaparecimento durante navegação, dois coletores isolados, drop de stone/capacidade, distinção de dig/alcance, Silk Touch escolhido, quantidade parcial, cancelamento sem depósito e cancelamento durante aproximação ao drop. `npm run check` aprovado; `npm test` **291/291**, zero falhas/skips. Node 22.22.3; script-shell temporário apenas prioriza Node 22 sobre Node 19 preexistente em node_modules, sem mudança de dependências.

Review local conferiu chamadores de mineBlocks, fallback/plugin, limites de tentativas/pickup, dados simples de evidência, isolamento por inventário e cancelamento antes de depósito. Corrigiu a derivação de Silk Touch para usar a ferramenta escolhida, não a previamente segurada. `git diff --check` aprovado. A preparação de crafting em lote mostrou inventário diferido e oak_button inesperado; não é prova de crafting aprovado e deve ser investigada no próximo gate.

PR/CI/merge e reteste pós-merge: pendentes no momento deste registro. Somente CI verde e reteste real permitirão declarar o gate aprovado. P0 completo continua **pendente**; próximo gate é crafting real, em outra branch. Nada de checkpoint, planner, Julia, logística nova ou state machine nesta PR.

`results.json` contém tarefas completas, inventários, posições, tempos, saúde/fome, pickups, erros e hashes dos arquivos brutos. As flags iniciais `cancelFalsePositive`/`itemMismatchFalsePositive` de before eram rótulos defeituosos do harness: o listener de cancelamento não disparou; não são utilizadas como prova de cancelamento.

## Reprodução das rodadas normais

Com o servidor de teste autorizado ativo e os três nomes de bots livres:

```sh
COLLECTION_REPORT=.data/forge-p0/collection/normal-retest.json node docs/evidence/collection-p0/normal-smoke.js
```

O harness executa exatamente três rodadas com dois workers. `FORGE_TEST_DIR` pode informar a pasta do servidor que contém o FIFO `console`; por padrão usa o servidor separado deste workspace. Aborta com vida <18 ou fome <8. A preparação de ferramenta é survival; não equivale à aprovação do gate de crafting. Não executar em servidor de produção.
