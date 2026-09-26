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

A versão publicada `mineflayer-statemachine 1.7.0` é de 23/01/2023 e declara dependências antigas, incluindo Mineflayer 4.x e pathfinder. O minecraft-mbot usa um fork de Mineflayer.

Antes de promover:

- verificar `npm ls mineflayer`;
- garantir uma única instância efetiva do Mineflayer;
- validar Node 22;
- validar `@wp2508/mineflayer`;
- testar listeners/eventos;
- confirmar que Movements não são alterados globalmente de forma inesperada.

Se houver incompatibilidade, avaliar `@nxg-org/mineflayer-static-statemachine` apenas como experimento alternativo.

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