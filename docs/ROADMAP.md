# Roadmap — minecraft-mbot

Atualizado em 2026-09-26.

Objetivo: evoluir o EduardoBot de companheiro determinístico para um orquestrador autônomo de colônia, preservando Minecraft Java 1.20.1, survival real, testes no servidor e fallbacks próprios.

## Princípios

1. APIs nativas do Mineflayer primeiro.
2. Plugins maduros entram atrás de feature flag/fallback antes de virar caminho padrão.
3. Não substituir comportamento validado no servidor real sem prova de ganho.
4. Workers continuam subordinados ao orquestrador; plugins não definem estratégia global.
5. Sobrevivência pode interromper qualquer tarefa.
6. PRs pequenos, CI verde e smoke real antes de promoção.

## P0 — Estabilização real no 1.20.1

Continuar priorizando bugs reproduzidos no servidor real: pathfinder concorrente, containers, crafting/furnace, workers presos, terreno irregular, cancelamento/retomada e custo de CPU com múltiplos bots.

---

## P1 — mineflayer-statemachine

### Objetivo

Usar `mineflayer-statemachine` como camada opcional para organizar comportamentos complexos dos workers e reduzir o crescimento de fluxos manuais em `WorkerController`.

Fonte oficial: https://github.com/PrismarineJS/mineflayer-statemachine

O README oficial do Mineflayer lista o plugin de state machine entre os plugins úteis para comportamentos complexos.

### O que ele oferece

- finite state machines;
- `StateTransition`;
- `BotStateMachine`;
- nested state machines;
- behaviors de movimento;
- mineração/colocação;
- busca de entidades;
- equipar itens/armadura;
- compartilhamento de targets/estado entre behaviors;
- visualização da máquina de estados.

Ele usa `mineflayer-pathfinder` para behaviors de movimento.

### Onde encaixa

Não substituir `ColonyOrchestrator`.

```text
ColonyOrchestrator
    ↓ escolhe objetivo
WorkerController
    ↓ inicia comportamento
StateMachine
    ↓
PREPARAR
→ OBTER RECURSOS
→ IR AO LOCAL
→ EXECUTAR
→ VERIFICAR
→ DEPOSITAR
→ VOLTAR
```

Sobre a máquina continua existindo um supervisor de sobrevivência:

```text
fome / creeper / dano / sufocamento
    ↓
interrompe comportamento
    ↓
sobrevive
    ↓
retoma ou replana
```

### Primeiro spike

Feature flag: `MBOT_STATEMACHINE=1`.

Migrar somente um fluxo inicialmente. Candidatos: exploração dirigida ou captura de animais.

Critérios do spike:

- comportamento atual continua como fallback;
- cancelar tarefa funciona;
- combate/fuga interrompem a máquina;
- goals do pathfinder não são sobrescritos indevidamente;
- worker retorna a `ocioso`;
- sem leak de listeners/timers;
- desempenho igual ou melhor no servidor 1.20.1.

### Riscos

A versão publicada `mineflayer-statemachine 1.7.0` é de 23/01/2023 e declara dependências antigas, incluindo Mineflayer 4.x e pathfinder. O repositório tem backlog aberto e há uma issue de 2024 questionando sua manutenção. O minecraft-mbot usa um fork de Mineflayer.

Antes de promover:

- verificar `npm ls mineflayer`;
- garantir uma única instância efetiva do Mineflayer;
- validar Node 22;
- validar `@wp2508/mineflayer`;
- testar listeners/eventos;
- confirmar que Movements não são alterados globalmente de forma inesperada.

Se houver incompatibilidade, avaliar `@nxg-org/mineflayer-static-statemachine` apenas como experimento alternativo.

### Spike automatizado de compatibilidade

O repositório possui um teste isolado em `scripts/statemachine-spike.js` e
`.github/workflows/statemachine-spike.yml`.

Esse spike NÃO adiciona o pacote ao runtime. O CI instala temporariamente
`mineflayer-statemachine@1.7.0` e verifica:

- Node 22;
- carregamento do pacote;
- `StateTransition` e `NestedStateMachine`;
- transição disparada por tick;
- resolução da mesma instalação de `mineflayer` usada pelo projeto;
- resolução da mesma instalação de `mineflayer-pathfinder`;
- comportamento de listener do `BotStateMachine`;
- presença do alias legado `physicTick` no Mineflayer instalado.

O spike também documenta duas limitações da versão 1.7.0: `BotStateMachine`
registra o evento legado `physicTick` (sem "s") e não expõe `dispose()`.
O Mineflayer atual ainda emite esse alias para compatibilidade, mas o marca como
deprecated e pode removê-lo no futuro. Por isso, uma integração futura não deve
criar uma instância nova a cada tarefa e deve encapsular o tick atrás de um
adapter. A estratégia preferida é uma máquina reutilizável por worker ou
atualização manual de `NestedStateMachine`.

### Spike de runtime: exploração

A primeira migração real usa apenas a tarefa `explorar` do worker.

Ativação experimental:

```bash
npm install --no-save --package-lock=false mineflayer-statemachine@1.7.0
MBOT_STATEMACHINE=1 node index.js
```

Com a flag desligada, a exploração clássica continua inalterada.

A integração não usa `BotStateMachine`. Ela usa `StateTransition` e
`NestedStateMachine` com atualização manual, evitando listener permanente no
evento legado do plugin.

Fluxo do spike:

```text
prepare
  ↓
navigate
  ├─ cancelado -> cancelled
  ├─ erro      -> failed
  └─ chegou    -> verify
                    ↓
                   done
```

O CI experimental instala o pacote temporariamente e valida sucesso,
cancelamento e falha. O próximo gate é testar esse caminho no servidor real
1.20.1 e comparar com a exploração clássica antes de adicionar a dependência ao
runtime normal.

### Critério para promoção

1. CI verde;
2. smoke real 1.20.1 verde;
3. menor complexidade que o fluxo manual equivalente;
4. cancelamento/preempção comprovados;
5. nenhuma regressão de CPU/pathfinding;
6. fallback antigo preservado durante a migração.

Prioridade: **ALTA, após estabilização do runtime atual**.

---

## P1/P2 — Construção por plantas

Objetivo:

```text
arquivo de planta
→ analisar materiais
→ produzir/coletar
→ dividir trabalho
→ construir
→ verificar bloco a bloco
→ corrigir faltas
```

Formatos desejados: Sponge `.schem`, Litematica `.litematic`, structure `.nbt` e schematic legado quando útil.

A construção deve funcionar em survival, sem OP e sem inventário criativo.

---

## P2 — mineflayer-builder

### Objetivo

Estudar e reaproveitar ideias do `mineflayer-builder` para orientação, ordenação e colocação de blocos, sem torná-lo dependência crítica antes de atender os requisitos de survival do minecraft-mbot.

Fonte oficial: https://github.com/PrismarineJS/mineflayer-builder

A última release publicada do `mineflayer-builder` é 1.0.1, de 11/04/2022. Existe um PR de release 1.1.0 aberto em 2026, mas não é uma release publicada. O próprio README atual declara o projeto work in progress e ainda não utilizável como pacote completo. O exemplo oficial pede mundo plano, bot OP e Creative.

### O que é útil para nós

- representação `Build` das ações;
- seleção de ações disponíveis;
- ordenação por distância;
- `GoalPlaceBlock`;
- orientação/facing;
- half/type;
- escolha de face/referência;
- integração com `prismarine-schematic`;
- verificação do `stateId` após colocar.

### Por que NÃO adotar diretamente agora

O código atual:

- usa `bot.creative.setInventorySlot`;
- executa `/clear`;
- usa API interna `bot._placeBlockWithOptions`;
- cria seus próprios `Movements`;
- altera `bot.pathfinder.searchRadius`;
- usa `maxDropDown = 256`;
- não entrega fluxo survival pronto no README.

Isso pode conflitar com proteção contra quedas, Movements dos workers, estoque real, produção, cancelamento e proteção de construções existentes.

### Estratégia

**Fase A — referência apenas**

- comparar algoritmo de orientação;
- comparar escolha de face;
- estudar `GoalPlaceBlock`;
- estudar `Build.getAvailableActions()`;
- portar somente ideias comprovadamente melhores.

**Fase B — laboratório opcional**

Feature flag: `MBOT_BUILDER_EXPERIMENTAL=1`, apenas em mundo descartável.

**Fase C — possível backend**

Só considerar se cumprir:

1. survival sem Creative;
2. sem OP;
3. sem `/clear`;
4. sem API privada do Mineflayer;
5. não sobrescrever Movements permanentemente;
6. compatibilidade Minecraft 1.20.1;
7. compatibilidade com o fork atual;
8. cancelamento seguro;
9. verificação de cada bloco;
10. proteção de blocos existentes;
11. integração com estoque/produção;
12. resultado melhor que o builder próprio.

Prioridade: **MÉDIA / EXPERIMENTAL**.

---

## P2 — Produção e logística automáticas

- metas de lã;
- metas de ovos;
- metas de leite quando fizer sentido;
- coletar apenas com déficit;
- depósito no estoque;
- cooldown;
- evitar workers presos em currais.

---

## P3 — Construção avançada

- planejamento de materiais;
- reserva por projeto;
- múltiplos construtores;
- fundação;
- terreno irregular;
- andaimes seguros;
- portas, camas, escadas, slabs, stairs e orientação;
- verificação e reparo;
- retomada após restart;
- plantas maiores.

`mineflayer-builder` deve informar esta etapa, mas não definir a arquitetura.

---

## P3 — Autonomia por behaviors

Se o spike de `mineflayer-statemachine` for aprovado, migrar progressivamente:

1. exploração;
2. captura/manejo animal;
3. coleta;
4. logística de estoque;
5. produção;
6. construção;
7. projetos compostos.

Não migrar tudo de uma vez.

---

## P4 — Mundo avançado

- encantamento;
- aldeões e comércio;
- Nether e portais;
- End;
- navegação entre dimensões;
- equipamentos avançados;
- farms especializadas;
- defesa coordenada da base.

### Campanha Survival completa → Ender Dragon → Endgame

Objetivo futuro: permitir que o bot comece em um mundo survival novo e progrida
por marcos observáveis até derrotar o Ender Dragon e alcançar o endgame, sem
entregar estratégia global diretamente ao modelo.

Arquitetura desejada:

```text
Campaign Manager
  → objetivo atual
  → Goal Planner
  → Player Loop V2
  → estado → candidatos válidos → decisão → validator → executor
  → novo estado
  → verificação de progresso
```

Progressão inicial planejada:

```text
SURVIVE
→ IRON_AGE
→ ESTABLISH_BASE
→ DIAMOND_AGE
→ ENTER_NETHER
→ FIND_FORTRESS
→ FARM_BLAZE
→ ACQUIRE_PEARLS
→ FIND_STRONGHOLD
→ PREPARE_END
→ KILL_DRAGON
→ FIND_END_CITY
→ GET_ELYTRA
→ GET_SHULKERS
→ NETHERITE
→ KILL_WITHER
→ BUILD_BEACON
→ INDUSTRIAL_ENDGAME
```

Cada objetivo deve ter pré-condições, condição objetiva de conclusão,
recuperação limitada e próximo objetivo. Regras críticas de sobrevivência
continuam determinísticas e podem interromper a campanha; após a emergência,
o bot retoma ou replana a partir do último checkpoint seguro.

A persistência deve ser mínima: campanha, objetivo atual, checkpoint e progresso
necessário para retomar após reconnect/restart. Não criar persistência complexa
nem permitir retomada automática antes de ela ser validada separadamente.

A implementação deve ser incremental:

1. `SURVIVE → IRON_AGE → DIAMOND_AGE → ENTER_NETHER`;
2. Fortress/Blaze/Pearls;
3. Stronghold/Ender Dragon;
4. End City/Elytra/Shulkers;
5. Netherite/Wither/Beacon;
6. infraestrutura e farms de endgame.

Critério final de sucesso: em teste survival controlado, partir de um mundo novo
e alcançar progressivamente os marcos da campanha sem intervenção humana,
mantendo safety layer, candidatos válidos, validator e executor determinístico.

**Fora do escopo do PR #78** e de qualquer trabalho de recuperação limitada de
drop/reconnect em andamento. Implementar somente em PR futuro dedicado.

---

## Critério geral de conclusão

```text
IMPLEMENTAÇÃO
→ TESTES
→ REVIEW
→ CORREÇÕES
→ PR
→ CI VERDE
→ MERGE
→ TESTE REAL 1.20.1
→ REGISTRO DO RESULTADO
```

Nunca considerar uma integração de plugin pronta apenas porque carrega sem erro.
## Estabilização aplicada — despacho e produção automática

- O orquestrador reserva o worker antes de iniciar a tarefa assíncrona e libera
  a reserva ao terminar, inclusive quando o executor lança um erro síncrono.
- Apenas uma sincronização automática do estoque pode ficar em andamento.
- Falhas consecutivas de um worker aumentam a espera até 10 minutos; um sucesso
  zera a sequência. Essa espera não substitui diagnóstico e escolha de outra rota.
- Na produção padrão de ferro e ferramentas, o planejador distingue insumos já
  disponíveis de resultados previstos. Reservas de combustível, ferro e madeira
  evitam reutilizar esses insumos entre artesãos no mesmo ciclo de planejamento.
- Um projeto só termina quando todas as ações estão concluídas; uma fatia que
  esgotou suas tentativas permanece visível como falha.

Regressões locais: `node --test test/auto-reliability.test.js test/core.test.js test/blueprint.test.js`.
Ainda falta validar esses cenários no servidor: estoque lento com dois workers,
recurso inacessível repetidamente e construção parcialmente bloqueada. Reservas
persistentes entre ciclos e recuperação por estratégia alternativa continuam pendentes.
