# `craftInternal` sem bloqueio do event loop (#79 / PR #80) — 1.20.1

Correção `1b654e3` (pai: `1691a02`). `npm ci`, `npm run check` OK; `npm test` **329/329**.
Medição por preload fora do repositório (`cpx.js`): cada chamada a `findCraftingTable` = 1 scan síncrono de `findBlock`,
duração de cada tarefa de worker, lag do event loop (relógio de 100 ms), e "Timed out" do servidor.
Baseline = worktree de `1691a02` (pré-correção), mesmo servidor/mundo/worker.

## Cenário da #79 — `lenhador` sem machado, sem mesa, sem materiais, `!ordem lenhador oak_log 1`

| | Baseline `1691a02` | Correção `1b654e3` |
|---|---|---|
| **Scans de mesa** | **1143** | **30** |
| Tempo somado nos scans | **42,1 s** (35–70 ms cada) | 1,2 s (1–1,2 s após o despacho) |
| **Maior lag do event loop** | **42 651 ms** | **2 833 ms** |
| **Bots caídos por *Timed out*** | **2** (`lenhador_01`, `eduardo_bot`) | **0** |
| Duração da tarefa | não terminou em 300 s | 102 s (`ok:false PATH_FAILED` do gather sem machado; os ~1,4 s de lag a cada ~30 s são A* do gather, não do crafting) |

## Fabricação com cadeia + mesa (plataforma plana)

`lenhador` com 3 troncos, sem machado/mesa: tarefa em **2,8 s**; fabricou machado de madeira, gravetos e tábuas;
**1 scan** (138 ms, mesa não encontrada) → mesa colocada → **15 de 16 consultas resolvidas pelo cache**; lag máx 803 ms;
0 quedas. (Na floresta a mesa foi fabricada mas não colocada por falta de espaço livre — 15 scans, 0,6 s, lag máx 1,6 s,
sem bloqueio; o problema ali é de posicionamento, não de event loop.)

## Controles (artesão, `!ordem artesao <item> <n>`)

| Controle | Scans de mesa | Cache | Duração | Resultado |
|---|---|---|---|---|
| 1. receita sem mesa (`oak_planks` ×4) | **0** | — | 88 ms | ok, 4 tábuas |
| 2. mesa próxima (`wooden_pickaxe`) | **1** (14 ms, achou) | 1 consulta, miss | 490 ms | ok |
| 3. 2ª fabricação, mesma mesa (`wooden_axe`) | **0** | 1 consulta, **hit** | 69 ms | ok |

Lag > 500 ms: nenhum nos 3 controles.

## Critérios

Sem bloqueio próximo de dezenas de segundos ✅ (42,7 s → 2,8 s); event loop respondendo ✅; 0 quedas por timeout ✅;
receita sem mesa não procura mesa ✅ (0 scans); mesa encontrada é reutilizada ✅ (0 scans na 2ª fabricação, 15/16 hits).

## Resíduos (não bloqueiam a PR)

- Mesa **inexistente** não é cacheada: 30 scans (39 ms cada) na cadeia sem mesa; só o resultado positivo entra no cache.
- Ainda há 1 bloqueio de ~2,8 s logo após o despacho em cadeia sem materiais (exploração síncrona das variantes de
  receita), 15× menor que antes. O pico "72 s" da #79 foi 42,7 s nesta máquina.
