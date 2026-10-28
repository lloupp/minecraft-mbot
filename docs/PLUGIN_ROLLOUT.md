# Rollout incremental de plugins Mineflayer — Minecraft Java 1.20.1

Esta PR **não instala novas dependências** e não muda o conjunto carregado por padrão. Ela introduz um mecanismo para isolar um plugin opcional por processo, testar cada componente e reverter instantaneamente na próxima inicialização. `pathfinder` continua carregado pelo `index.js`, fora da seleção.

## Estado auditado

| Integração | Estado atual | Próximo teste |
|---|---|---|
| [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder) | já integrado, obrigatório | rotas concorrentes, cancelamento |
| [mineflayer-pvp](https://github.com/PrismarineJS/mineflayer-pvp) | loader `pvp` | PvE, alvo inválido, interrupção |
| [custom-pvp](https://github.com/nxg-org/mineflayer-custom-pvp) | loader `custompvp` | conflito com escudo e PvP anterior |
| [mineflayer-tool](https://github.com/TheDudeFromCI/mineflayer-tool) | loader `tool` | escolha de ferramenta sem mexer no crafting |
| [mineflayer-collectblock](https://github.com/PrismarineJS/mineflayer-collectblock) | loader `collectblock` | coleta, queda e cancelamento |
| [minecraftHawkEye](https://github.com/sefirosweb/minecraftHawkEye) | loader `hawkeye` | arco e limpeza de estado após luta |
| [prismarine-viewer](https://github.com/PrismarineJS/prismarine-viewer) | opt-in via `MBOT_VIEWER_PORT` | segurança localhost, consumo de CPU |
| [mineflayer-web-inventory](https://github.com/ImHarvol/mineflayer-web-inventory) | opt-in via `MBOT_INVENTORY_PORT` | sessões e reconexão |
| [mineflayer-statemachine](https://github.com/PrismarineJS/mineflayer-statemachine) | spike separado | testar exploração no servidor antes de promover |
| [MineflayerArmorManager](https://github.com/G07cha/MineflayerArmorManager) | descartado no runtime: conflito documentado com crafting | **não reinstalar** sem evidência de correção |

## Candidatos que podemos estudar depois, um a um

| Plugin | Uso pretendido | Risco a controlar |
|---|---|---|
| [mineflayer-tps](https://github.com/SiebeDW/mineflayer-tps) | telemetria do servidor e alerta de lag | manter somente observação |
| [mineflayer-death-event](https://github.com/tuanzisama/mineflayer-death-event) | identificar morte do bot/jogadores | evitar duplicar o sistema de recovery |
| [mineflayer-bloodhound](https://github.com/Nixes/mineflayer-bloodhound) | reconhecer agressor em combate | falsos positivos e retaliação indevida |
| [mineflayer-auto-eat](https://github.com/link-discord/mineflayer-auto-eat) | alimentação automática | não concorrer com `lib/food.js` ou crafting |
| [mineflayer-statemachine](https://github.com/PrismarineJS/mineflayer-statemachine) | composição de comportamentos | evitar dupla autoridade de tarefas |

## Como validar sem afetar o bot principal

Baseline com as dependências instaladas:

```bash
npm ci
npm run check
npm test
npm run gauntlet:player-loop
npm run plugin:probe
```

A pré-verificação `plugin:probe` resolve e inspeciona o export de **cada um dos cinco plugins do loader**, um de cada vez, sem iniciar bot nem servidor. Não substitui integração real.

## Evidência de gameplay real — 28/10/2026

Workflow isolado: https://github.com/lloupp/minecraft-mbot/actions/runs/40626240156

O CI executou `scripts/plugin-live-smoke.js` em cinco jobs independentes, cada um iniciando servidor oficial vanilla Java 1.20.1 verificado por SHA-1, um bot e **um** plugin do loader (além do pathfinder obrigatório). Os cinco jobs concluíram em `success`. Logs e relatórios JSON individuais estão nos artifacts do workflow (não incluem mundo nem JAR).

| Plugin | Ação física comprovada | Resultado |
|---|---|---|
| `pvp` | alvo cow removido pelo combate corpo a corpo | PASS |
| `custompvp` | alvo cow removido pelo motor alternativo | PASS |
| `tool` | diante de stone, selecionou `iron_pickaxe` sobre `wooden_pickaxe` | PASS |
| `collectblock` | `oak_log` no mundo virou ar e estoque de log 0 → 1 | PASS |
| `hawkeye` | disparou arco real: flechas 32 → 31 | PASS |

Todos registraram `connect_spawn` e `no_disconnect_or_error`; os limites foram de 22 s para combate e 18 s para disparo. Hawkeye **não** comprova impacto ou precisão, somente lançamento de projétil. Os testes não cobrem Forge, itens modded, cancelamento/reentrada, longos períodos, múltiplos bots simultâneos ou o `index.js` integral. Eles provam apenas comportamento de cada plugin em bot de teste isolado. Portanto, **não** são critério suficiente para promover novo plugin ou considerar a integração completa no orquestrador.

CI normal da mesma revisão: https://github.com/lloupp/minecraft-mbot/actions/runs/40626240117 — aprovado. A PR permanece em rascunho até validar os comportamentos combinados com o player loop.

Em **servidor de teste descartável**, com o mesmo mundo, seed, perfis e tarefas de baseline, execute separadamente (não ao mesmo tempo):

```bash
MBOT_PLUGINS_ONLY='' node index.js
MBOT_PLUGINS_ONLY=pvp node index.js
MBOT_PLUGINS_ONLY=custompvp node index.js
MBOT_PLUGINS_ONLY=tool node index.js
MBOT_PLUGINS_ONLY=collectblock node index.js
MBOT_PLUGINS_ONLY=hawkeye node index.js
```

O `pathfinder` continua presente em todos os casos. Avaliar em cada execução: spawn/reconnect, objetivo concluído, cancelamento, interferência em navegação/combate/inventário, listener count, erros, TPS, CPU/memória. A aprovação exige melhoria demonstrável sobre o baseline e zero regressões críticas. Testar combinações **só depois** de cada plugin individualmente aprovado.

Rollback (na próxima inicialização): `MBOT_PLUGINS=0 node index.js`. `MBOT_PLUGINS_SKIP=pvp` continua disponível. Deixar `MBOT_PLUGINS_ONLY` **ausente** mantém o comportamento anterior; definir como vazio desliga todos os opcionais do loader. `SKIP` prevalece sobre `ONLY`.

**Limitação desta PR:** os smokes reais isolados **demonstram apenas as ações da tabela**, sem validar integrações concorrentes, cancelamento após efeitos colaterais, Forge ou gameplay contínuo. Não executar experimentos no servidor de produção. Não promover integrações nem fazer merge até o teste completo do runtime e dos critérios de regressão passar.
