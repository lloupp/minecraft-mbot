# Plano — autonomia de missões (Fases 0 e 1)

Status: **Fases 0 e 1 implementadas** nesta branch. A Fase 1c (arbitragem global
com preempção) permanece explicitamente pendente, como o plano exige.
Base: `feat/missao-minerios-equipe` (8e8e718).
Sem dependência nova, sem autoridade de modelo, sem alteração do servidor Minecraft.

## Implementação nesta PR

Arquivos novos: `lib/nav-telemetry.js`, `lib/failure.js`, `lib/preflight.js`,
`lib/mission-spec.js`, `lib/verifiers.js`, `core/MissionStore.js`,
`core/Capabilities.js`, `core/MissionRunner.js`, `core/mission-executors.js`.

Integrações: `lib/plugins.js` (telemetria em todos os bots), `core/TaskGraph.js`
(status validado e metadados do nó), `core/RunVerifier.js`
(`mission_consistency`), `index.js` (`!missao`, store/runner, `runTask` com
`deposit:false` para missões), `.env.example` e `README.md`.

Verificação executada:

- `npm run check`: 112 arquivos.
- `npm test`: **1015/1015**.
- Servidor real (Forge 1.20.1), bot isolado `mission_smoke`:
  - `!missao pegar dirt 2` concluiu com `before=1, after=2, mined=1` e voltou a `ficar`;
  - `!missao cancelar` marcou o nó como `cancelled` e restaurou `ficar`;
  - missão interrompida com `!parar` voltou como `interrupted` no restart e
    `!missao retomar` concluiu com verificação absoluta (`after=15 >= 12`).
- O servidor Minecraft não foi reiniciado nem alterado; o bot principal em
  execução não foi tocado.

## Teste E2E em servidor real (Python)

`test/test_mission_server.py` sobe um vanilla 1.20.1 descartável, usa RCON para ler o inventário no
lado do servidor e cobre:

- `!missao pegar dirt 2` conclui e o servidor vê o item na mochila;
- `!missao cancelar` marca o nó como cancelado e restaura `ficar`;
- `!missao pegar dirt 24` interrompida com `!parar` volta como `interrupted` e `!missao retomar`
  conclui sem reexecutar trabalho já verificado.

O job `mission-server-e2e` executa a suíte em PRs. Localmente, defina `MBOT_TEST_SERVER_JAR` e
`MBOT_TEST_EULA_ACCEPTED=1`; Java 17+ é obrigatório.

Resultado local (Java 21, servidor vanilla 1.20.1): **3/3 em 112 s** — coleta, cancelamento e
retomada pós-restart, com inventário conferido por RCON.

## Objetivo

Permitir que o dono peça uma tarefa em uma única mensagem e o bot a execute de ponta a
ponta: entender o pedido, decompor, executar com as skills existentes, verificar o
resultado no mundo/inventário/baú, recuperar de falhas e relatar progresso.

O diagnóstico é que as habilidades já existem. Falta um **contrato de execução**
uniforme: estado durável, pré-condições, pós-condições verificáveis, taxonomia de falha
e um ponto único de admissão.

## Premissas

- Arquivos novos ficam planos em `lib/` ou `core/`: `scripts/check-syntax.js` não é recursivo.
- Testes usam diretórios temporários; nunca `.data/live-mission-*`.
- Fase 0 entra atrás de `MBOT_MISSIONS=0` (padrão desligado): nenhuma decisão muda.
- Nenhum timer novo; pathfinding mantém `tickTimeout=8` e `thinkTimeout=25 s` nos workers.
- LLM, se entrar depois, só emite `TaskSpec` validado; nunca executa código.
- Ações físicas só contam como concluídas com verificação independente.

## Fase 0 — fundação invisível

### 0.1 Telemetria de navegação

`lib/nav-telemetry.js`

```js
attach(bot)            // idempotente (WeakMap), no-op sem pathfinder
snapshot(bot)          // { lastStatus, lastResetReason, counts, lastAt }
lastFailure(bot)       // { code, reason, at } | null
```

Escuta `path_update` (`success|partial|timeout|noPath`), `path_reset`
(`goal_updated|movements_updated|block_updated|chunk_loaded|goal_moved|dig_error|place_error|no_scaffolding_blocks|stuck`),
`goal_reached` e `path_stop`. Não chama API do pathfinder e não cria timer.

Hook: uma linha em `lib/plugins.js`, que cobre principal e workers após o pathfinder.

Testes: mapeamento de cada status/reason, ausência de pathfinder, attach duplicado.

### 0.2 Taxonomia de falha

`lib/failure.js`

```js
CODES = { PATH_NO_PATH, PATH_TIMEOUT, PATH_STUCK, PATH_DIG_ERROR, PATH_PLACE_ERROR,
          PATH_NO_SCAFFOLD, PROTECTED_AREA, RESOURCE_NOT_FOUND, RESOURCE_UNREACHABLE,
          TOOL_MISSING, FOOD_MISSING, INVENTORY_FULL, CONTAINER_UNREACHABLE,
          CONTAINER_FULL, NOT_SPAWNED, DEAD, WRONG_DIMENSION, VERIFICATION_FAILED,
          CANCELLED, INTERRUPTED, UNKNOWN }
classify({ error, code, nav, context }) // -> { code, detail, retryable, action }
```

`action` ∈ `retry | alternate_target | split_route | unstick | withdraw_tool | eat |
free_slots | abort`. Reaproveita `COLLECTION_FAILURE` de `lib/gather.js` e mensagens já
conhecidas ("caminho demorou demais", `destination full`, `blockUpdate ... timeout`).

Testes: tabela de mapeamento, `retryable` por código, erro desconhecido.

### 0.3 Preflight

`lib/preflight.js`

```js
check(bot, spec, { storage, registry }) // -> { ok, blockers: [{ code, detail, action }] }
```

Checa spawn, vida, comida para tarefa longa, slots livres, ferramenta, combustível,
baú configurado para entrega e dimensão do waypoint.

Testes: um caso por blocker e o caminho ok.

### 0.4 MissionStore

`core/MissionStore.js`, arquivo `.data/missions.json` (`MBOT_MISSION_FILE`).

```js
{ version: 1, missions: { [id]: { id, spec, graph: [nodes], status, evidence,
  lastError, nodeAttempts, createdAt, updatedAt } } }
```

Status: `pending|running|paused|completed|failed|cancelled|interrupted`.
`load()` converte `running` em `interrupted` com `recoveryRequired`. Escrita atômica
tmp+rename, writes serializados, arquivo corrompido preservado. Retenção: terminais com
mais de 7 dias ou acima de 100 missões saem primeiro.

Testes: create/load, interrupção, corrupção, concorrência, poda.

### 0.5 Registro de capacidades

`core/Capabilities.js`

```js
{ name, action, role, argsSchema, preconditions, effects, verifier,
  failureCodes, cost, risk }
```

Conjunto inicial: `gather`, `craft`, `smelt`, `deposit`, `withdraw`, `move_to`,
`deliver`, `farm_wheat`. `validateArgs`, `available(bot)`, `describe()`. Metadado puro.

Testes: schema, capability desconhecida, gating por ferramenta/baú.

### 0.6 Eventos e prova

Tipos `mission_created`, `mission_node_started`, `mission_node_completed`,
`mission_node_failed`, `mission_completed`, `mission_cancelled`, `mission_recovered`
via `EventLog.log`. `RunVerifier.verify()` ganha `mission_consistency`: todo nó iniciado
tem terminal e nenhuma missão `completed` sem evidência.

Aceite da Fase 0: `npm run check` e a suíte atual verdes; nenhuma decisão alterada;
flag desligada mantém o bot idêntico.

## Fase 1 — primeira missão executável

### 1.1 MissionRunner

`core/MissionRunner.js`

```js
new MissionRunner({ store, capabilities, executors, verifiers, eventLog, logger, clock })
run(missionId, { isCancelled, onProgress }) // -> { ok, status, graph, evidence, failure }
cancel(missionId)
```

Loop: `graph.ready()` → executor → preflight → `graph.start` → executa → verifica →
`complete/fail` → persiste. Regras:

- Sequencial por missão; paralelismo só entre workers.
- Antes de retry, checa se o pós-condição já está satisfeito; se sim, conclui.
- Tentativas persistidas antes da execução; falha `retryable` agenda retry com backoff;
  falha terminal bloqueia dependentes.
- Cancelamento marca o nó `running` como `cancelled`, persiste e libera o lease.
- Usa `TaskGraph` para ordem e adaptadores diretos para as skills; não usa
  `TaskScheduler` ainda, porque ele exige o formato do Tool API e cobre 12 ações.

### 1.2 MissionSpec e comando `!missao`

`lib/mission-spec.js`

```text
!missao pegar|coletar <item> <qtd> [guardar]
!missao fabricar <item> <qtd> [guardar]
!missao entregar <item> <qtd> [bau|mao]
!missao ir <local>
!missao status [id]
!missao cancelar <id>
!missao retomar <id>
```

Resolve aliases com `handover.normalizeItem`/`normalizeItemName`; usa `Clarifier` só para
slot faltante; rejeita item inexistente no registry antes de criar a missão.

### 1.3 Executores e verificadores

`core/mission-executors.js` e `lib/verifiers.js`

| Capacidade | Reaproveita | Verificador |
|---|---|---|
| `gather` | `gather.mineBlocks` | `inventory_delta` |
| `craft` | `craft.craftItem`/`ProductionManager` | `inventory_delta` |
| `smelt` | `craft.smeltItem` | `inventory_delta` |
| `deposit` | `storage.depositMany` | `container_contains` |
| `withdraw` | `storage.withdraw` | `inventory_delta` |
| `move_to` | `pathGuard`/`food.goTo` | `position_near` |
| `deliver` | `handover.deliverTo` | inventário + readback do contêiner |
| `farm_wheat` | `lib/farm` | contagem de trigo |

Toda mutação exige readback; mensagem de chat/HTTP não conta.

### 1.4 Persistência e retomada

Missão e grafo salvos a cada transição. No startup, `running` vira `interrupted`.
Não retoma automaticamente: o dono usa `!missao retomar <id>`, consistente com a
política de não repetir trabalho físico sem confirmação. Ao retomar, cada nó
`interrupted` roda a checagem de progresso antes de executar.

### 1.5 Admissão e arbitragem

1a (baixo risco): `MissionRunner` só aceita a missão se o principal estiver livre e
nenhum worker estiver reservado; senão responde "ocupado" com o motivo. Sem preempção.
1b: migrar `!lapis`, `!dar` e `!minerios` para o runner, mantendo os comandos antigos
como fachada.
1c (depois de provado): `core/MissionArbiter.js` com lease por bot, prioridade
`dono > fila > projeto > auto > exploração` e preempção que pausa a missão anterior.

### 1.6 Relatório

Chat: `[missão abc] 2/4 coletando carvão (12/32)`; falha com código e ação
recomendada; conclusão só após verificador. Dashboard: expor `missions` no snapshot
em fatia separada.

## Mapa de arquivos

| Arquivo | Ação | Fase |
|---|---|---|
| `lib/nav-telemetry.js` | novo | 0.1 |
| `lib/failure.js` | novo | 0.2 |
| `lib/preflight.js` | novo | 0.3 |
| `core/MissionStore.js` | novo | 0.4 |
| `core/Capabilities.js` | novo | 0.5 |
| `lib/mission-spec.js` | novo | 1.2 |
| `core/mission-executors.js` | novo | 1.3 |
| `lib/verifiers.js` | novo | 1.3 |
| `core/MissionRunner.js` | novo | 1.1 |
| `core/MissionArbiter.js` | novo | 1.5c |
| `lib/plugins.js` | hook de telemetria | 0.1 |
| `index.js` | `!missao`, init/restore | 1.2–1.4 |
| `core/RunVerifier.js` | check de missão | 0.6 |
| `test/*.test.js` | ~8 arquivos | 0–1 |

## Matriz de testes

| Área | Casos mínimos |
|---|---|
| Telemetria | cada `path_update`/`path_reset`, sem pathfinder, idempotência |
| Taxonomia | cada código, retryable, erro desconhecido |
| Preflight | cada blocker, caminho ok |
| Store | interrupção, corrupção, concorrência, poda |
| Capabilities | args, disponibilidade, capability desconhecida |
| Runner | sucesso, verificação falha, retry, esgotamento, dependência bloqueada, cancelamento |
| Parser | aliases, quantidade inválida, defaults |
| Integração | gather→deposit com bot falso |
| Servidor real | `!missao pegar 4 carvão` antes/depois no inventário e baú |

## Critérios de aceite da Fase 1

- `!missao pegar 4 carvão` e `!missao entregar 8 pão` concluem ou falham com causa classificada.
- Nenhuma missão `completed` sem pós-condição verificada.
- Cancelamento efetivo em < 2 s.
- Matar o processo no meio não repete trabalho no restart; `!missao retomar` continua do
  último nó confirmado.
- Comandos antigos intactos; suíte existente verde.

## Riscos e guardrails

- Edição concorrente: não tocar em `core/StorageManager.js`; Fase 0 é aditiva.
- CRLF: arquivos novos em LF e staging explícito; diff real por `git diff --ignore-cr-at-eol`.
- CPU: nada de timer novo; pathfinding inalterado.
- Autoridade: LLM nenhum no caminho de execução.
- `TaskGraph.add` não valida `status`: endurecer ao restaurar snapshot.
- Servidor protegido: `place_error`/container recusado vira `PROTECTED_AREA`, sem
  três retries inúteis.

## Ordem de execução

1. 0.1 + 0.2 — telemetria e taxonomia.
2. 0.3 + 0.4 + 0.5 — preflight, store, capabilities.
3. 1.1 + 1.2 + 1.3 com `!missao pegar`.
4. 1.4 + 1.5a/b — retomada, admissão e migração de `!lapis`/`!dar`.
5. 1.5c — arbiter, só depois de duas missões reais certificadas.
