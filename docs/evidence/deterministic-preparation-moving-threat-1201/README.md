# Preparação determinística — ameaças móveis e mutações, Minecraft 1.20.1

Referência: `7286200d7b1bee0e239fc76568af5727b23c8006`, branch `experiment/julia-laya-andy-player-loop-v2`, PR #78. Sessões de 2026-10-01 UTC (2026-09-30 em São Paulo). Evidência produzida por servidor Java 1.20.1 real, Mineflayer e WorkerController; Julia oficial carregada em CPU apenas em shadow.

**Comprovado:** aproximação natural de zombie com AI ativa; dano real durante dig e durante bot.craft/craftInternal; interrupção preservando inventário; retomada pela política limitada a partir de snapshots novos; nenhuma nova operação de preparação após safety detectado nas capturas corrigidas. A política continua apenas construindo tarefas. Flag opt-in, sem ativação automática global, sem autoridade Julia, sem merge/main/benchmark longo.

| Cenário | Captura aceita | Resultado |
|---|---|---|
| Política limitada | verification/policy | 8/8: gather singleton com allowlist cria tarefa; sem allowlist, ameaça, fome crítica, cancelamento e armado retornam null; prepare_combat e equip de stone_sword permitem tarefa |
| Zombie móvel | final/moving | Zombie surge a 18 blocos, anda por AI até entrar no raio real de 16 durante o segundo dig; THREAT, dig abortado, 1 cobblestone preservado; coleta somente 1 restante e equipa espada |
| Golpe durante dig | final/attack_gather | Vida 20→17 entre dig_start e dig_error; reflexo cancela ownership, retorno CANCELLED, 1 cobblestone preservado; após ameaça removida, coleta somente 1 e prepara espada |
| Golpe durante craft | verification/attack_craft | Vida 20→17 entre craft_start e craft_end, com craftInternal ativo; THREAT; craft já em voo produz 1 espada; defesa aguarda o assentamento da preparação antes de executar reação |
| Safety × craft | verification/safety_craft_race | Ameaça real recebida após validação assíncrona da mesa; THREAT antes de qualquer bot.craft; 2 cobblestones + 1 stick preservados; remoção da ameaça permite craft/equip |
| Mesa removida | final/table_removed | NEARBY_TABLE_REQUIRED após preflight, antes de craft; nenhuma mesa fabricada/colocada; inventário preservado; mesa explicitamente restaurada permite retomada |
| Cobblestone removido | verification/remove_cobblestone | RECIPE_INPUTS_CHANGED, inventário real com 1; política recalcula falta de 1; nova pedra explicitamente autorizada é coletada; espada equipada |
| Espada adicionada | verification/add_sword | Craft desnecessário é pulado, 0 bot.craft, 1 espada equipada; 2 cobblestones e stick continuam disponíveis |
| Picareta removida | final/remove_pickaxe | MINING_PICKAXE_REQUIRED após primeiro pickup; segunda pedra não é quebrada; restaurar ferramenta permite coletar somente o restante |

As retomadas aceitas terminam em `[continue_objective]`. `summary.json`, derivado por `summarize.py`, contém timestamps, distância/posição, última operação antes da percepção, material confirmado e resultados/asserts. `timeline.jsonl` registra taskVersion/ownership, eventos de safety efetivamente detectado, início/fim de operações, health, inventário, fases, posição/velocidade do zombie e mudanças de fixture.

**Auditoria das capturas corrigidas:** 20 digs de preparação autorizados (15 na primeira correção, 5 na verificação); 0 digs fora da allowlist; máximo de 1 chamada física simultânea por bot; 0 novos dig/craft/equip do ownership de preparação depois de safety; 0 erros inesperados do bot/harness e 0 timeouts. Dig abortado, THREAT, CANCELLED, recipe/tool/table refusals são eventos esperados, preservados; isso não declara as baselines bem-sucedidas. Equip/ataque pelo novo ownership de defesa pertence ao reflexo existente, não à tarefa de preparação cancelada.

**Bugs observados e ajustes:**

- Na referência, um bot.craft começou depois de a ameaça ser efetivamente observada no await da mesa. A ponte agora passa uma checagem síncrona ao ProductionManager imediatamente antes de NOVO craft, após os awaits. Gather/equip também recebem o guard antes da operação. O primeiro motivo de safety fica retido até encerrar a tentativa; ameaça desaparecer não reativa a tarefa antiga.
- Mesa removida depois do preflight levou o ProductionManager a fabricar e colocar outra. O contexto opcional `localOnly` da ponte exige mesa viva próxima e ingredientes já presentes, sem scan/bootstrap, depósito/fundição ou fabricação recursiva de ingredientes. O bloco da mesa utilizada é novamente conferido antes de craft. Defaults dos outros callers permanecem iguais.
- Espada adicionada no await original não evitava um segundo craft (2 espadas no inventário, consumo desnecessário de inputs). O guard lê o inventário real, sinaliza arma já disponível e a ponte pula o craft/equipa a existente. A primeira correção revelou outra falha: a tentativa de outra variante da receita sobrescrevia esse sinal com erro de ingredientes. Sinal agora propagado e teste cobre múltiplas receitas.
- Ferramenta e ingredientes eram assumidos desde o preflight. Antes do dig/equip, a ferramenta atual é conferida; crafting local valida os inputs efetivos e retorna falha específica, sem buscar/substituir materiais genericamente.
- O reflexo de dano agora invalida ownership imediatamente, mas aguarda preparação em voo assentar antes da reação física. A limitação de craft já iniciado é mantida; nenhuma promessa de rollback.
- Logging captura a versão dona da preparação separadamente da versão atual do worker. Na primeira correção, o log de safety durante troca de ownership ainda usava a versão atual; dig_start/entry/return identificam o ownership daquela captura. Verificação posterior contém ambos os campos corretos.

**Método e limites da prova real:**

O caso móvel não usa NoAI ou teleport do zombie: AI ativa, follow_range=48, movement_speed=0.35, capacete para não queimar de dia. Após confirmar o primeiro cobblestone, a fixture aplica mining_fatigue para manter o segundo dig em voo durante a aproximação. Movimento e entrada no raio são medidos, não presumidos.

Os casos de ataque usam zombie com AI ativa previamente colocado a 18 blocos e movement_speed=0 para controlar o momento de contato, sem NoAI. Com operação física já iniciada, comando de servidor aproxima esse zombie por teleport; o golpe/dano vêm do servidor e AI real, não de damage/effect/mock. Aproximação natural e impacto controlado são provas diferentes. No craft aceito, o jogador olha inicialmente para longe da mesa, situada a ~3,8 blocos; a rotação/abertura real estende a operação o suficiente para receber o golpe. Não há delay artificial de promise, simulação de item ou resultado produzido por mock.

A corrida safety × ação usa um gate de agendamento de teste no await real de ensureCraftingTable: o wrapper devolve a mesa real somente após o cliente observar o zombie real. Isso reproduz a janela assíncrona da baseline; não altera o estado/modelo nem fabrica resultado físico. A correção impede a nova chamada bot.craft. Uma chamada bot.craft já iniciada antes da ameaça pode continuar enviando cliques e produzir item; isso é continuação de uma operação em voo, não novo craft autorizado após safety.

Servidor offline isolado, plataformas elevadas em `moving-threat-world`, pathfinder com canDig=false. Fixture é limpa e vida/fome normalizadas **entre cenários**; não se injeta material de resultado durante retomadas. Os comandos de remover/add item e remover/restaurar mesa são exatamente as mutações controladas pedidas e aparecem no log. Na retomada com cobblestone removido, uma nova fonte de pedra `(0,200,0)` é adicionada ao mundo e autorizada explicitamente, distinta dos dois alvos já destruídos. O inventário é confirmado após seu pickup.

O construtor de dispatch recebe snapshots novos. O caso de cancelamento usa uma flag controlada sobre snapshot real congelado; não é uma ordem física de cancelamento nesse teste de função. Ameaça, fome crítica (cow real próxima, food≤5), armado/craftable/carry são snapshots vivos. O harness só chama WorkerController.run depois de registrar o objeto retornado pela função, sem conectar um dispatcher automático.

**Falhas preservadas:**

- `baseline/`: referência sem correções. Craft pós-percepção, mesa recriada/colocada e segunda espada indevida. Os golpes dos dois primeiros testes de ataque chegaram **depois** de a preparação já parar; não são prova de dano em voo.
- `final/`: primeira correção. Móvel, ataque durante dig, race recusada, mesa e ferramenta funcionam. A primeira tentativa de ataque no craft ainda recebeu golpe após a parada; há um snapshot transitório vazio durante equip da defesa, seguido de espada real confirmada. Cobblestone removido foi recoletado, mas novo pickup deixou a mesa fora do limite de 4; a localização da fixture foi corrigida. O sinal de espada existente foi sobrescrito por outra receita; falha mantida.
- `verification/`: repete apenas política/mutações afetadas, corrida/ownership logging e janela de craft. Prova dano durante craft, estado estável após defesa, skip de espada e retomada completa da coleta faltante perto da mesa.

Cada sessão preserva results.json, timeline.jsonl, logs Java/Julia, ambiente e hashes do código. A verificação também arquiva `harness-source.txt`. `final-code-sha256.json` identifica o código publicado; os hashes por captura identificam suas versões exatas. A última mudança apenas preserva o código de erro legado do gather fora do opt-in, com regressão unitária; o caminho opt-in medido não muda.

**Verificações:** HEAD inicial correto; npm run check passou, testes pedidos 16/16, Python 2/2. CI e StateMachine do HEAD de referência verdes (initial-ci.json). Depois das correções: check OK, focados 39/39, npm test completo **462/462**, Python **2/2**. Logs incluídos. Primeiro npm test 461/461 também preservado, anterior à regressão de compatibilidade do gather. Julia: 8 + 11 + 6 inferências reais nas três sessões, 0 erros de sidecar; nenhuma decisão consumida pelo executor.

**Ainda falta antes do fluxo normal:** reconnect/pickup pendente não foi executado porque ameaças revelaram bug real neste ciclo; prioridade ficou na correção/revalidação conforme pedido. Cancelamento permanece cooperativo, monitor periódico e observação limitada ao que o cliente recebeu; não há cancelamento atômico de craft. Não validamos eficácia de combate, persistência, ameaça em todos os ticks de uma operação, perda de mesa depois de craft já iniciado ou reversão completa de reflexo em voo para nova preparação. O harness espera defense settlement e snapshot sem threat antes de construir retomada; a política pura não substitui esse ownership. Antes de ligá-la, falta definir/validar esse handoff e snapshots estáveis também com alimentação/reconexão, mantendo executor estreito e Julia somente shadow.

Reprodução com Java 17/dependências/modelo já instalados, em instalação isolada do servidor:

```sh
ORDER_OUTPUT_DIR=/absolute/fresh-output \
ORDER_SERVER_DIR=/absolute/server-install \
ORDER_PYTHON=/absolute/venv/bin/python \
JULIA_MODEL=/absolute/local-model \
MBOT_DETERMINISTIC_PREPARATION=1 \
SCENARIOS=moving,attack_gather,attack_craft,race,table,inventory,pickaxe \
node docs/evidence/deterministic-preparation-moving-threat-1201/run.js
```

`SCENARIOS=policy,attack_craft,race,inventory` repete a verificação afetada. Porta Minecraft 25566, sidecar 8768. Usar pasta nova para cada captura; serviços/bot encerrados depois do teste.
