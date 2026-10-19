# Descrição enriquecida de `gather_materials` muda a Julia-1? — 1.20.1

PR #78, HEAD `c6c1de1`; Julia-1 **somente shadow** (`executionAuthority:"none"`); nenhum código, prompt, descrição ou guardrail
alterado nesta rodada (`main` intocada). `npm run check` OK; `node --test test/player-loop-distance-context.test.js` **3/3**.
Comparação direta com `../julia-gather-bias-1201/` (mesma plataforma de terra, mesma grade de amostragem de `nearbySignals`,
mesmo driver adaptado: `ctx_groups.sh`).

## Verificação da descrição (payload real enviado, `runtime/julia-payloads.jsonl`)

`gather_materials.description` = "… Observed nearby materials: wood approximately 2.0 blocks away, stone approximately 2.0 blocks away."
Só madeira: "… wood approximately 2.0 blocks away." Nenhum payload contém `0.0 blocks away` (0 ocorrências).
Distância desconhecida → "wood nearby" (coberto pelo teste unitário; não ocorreu em runtime, pois o mundo sempre fornece distância).

## Runtime (6 decisões por grupo; `runtime/rows.json` tem estado, descrição completa, ordem, escolha, confiança, latência, erro)

Ordem dos candidatos em **todas** as decisões: `gather_materials`, `continue_objective`.

| Grupo | Estado (distâncias) | Decisões | `gather_materials` | `continue_objective` | Confiança | Latência | Erro |
|---|---|---|---|---|---|---|---|
| G1 `explore` madeira+pedra ~2 | 2 / 2 | 6 | **0** | 5 | 1,000 | 239–259 ms | 1 timeout (1ª chamada, cold start 5,7 s > 4 s) |
| G2 `explore` recursos ~5,7 | 5,7 / 5,7 | 6 | **0** | 6 | 0,873 | 265–301 ms | 0 |
| G3 `explore` só madeira | 2–4 | 6 | **0** | 6 | 0,999–1,000 | 230–324 ms | 0 |
| G4 `mine_iron` madeira+pedra+ferro | 2–4 | 5 (+1 pulada) | — | — | — | 463–720 ms | **5× HTTP 400 `Option exceeds 48-token model contract`**; 6ª = `breaker_open` |

- **Explore: 0/17 decisões válidas** escolhem `gather_materials` (baseline: 0/30). Com confiança até maior que no baseline em G2
  (0,873 vs 0,652). Distância 2 ou 5,7 não muda a escolha; só a confiança.
- **G4 é inválido por efeito colateral da própria mudança:** com os 3 materiais a descrição passa do limite de 48 tokens por
  opção do modelo, o sidecar responde 400, e a Julia **não decide nada** (5 erros seguidos abrem o circuit breaker). O
  baseline tinha 8 decisões válidas de `mine_iron` nesse cenário; agora tem 0. Não corrigi (instrução: sem novo ajuste de descrição).

## Varredura offline (payload real do runtime; descrição **regenerada** por `candidateIntents()` para cada distância/recursos)

Objetivos `explore`/`mine_iron` × distâncias 1, 2, 4, 6 × recursos {wood, wood+stone, wood+stone+iron} × 2 ordens = 24 por
objetivo; `wood+stone+iron` (8/objetivo) **inválido pelo mesmo HTTP 400**, restando 16 válidas.

| Objetivo | `gather_materials` (válidas) | Baseline | Por ordem (gather 1º / continue 1º) | P(gather) máx |
|---|---|---|---|---|
| `explore` | **0/16** | 0/84 | 0/8 / 0/8 | 0,0006 |
| `mine_iron` | **1/16** | 19/84 | 0/8 / 1/8 | 0,53 (wood, d=1, continue primeiro) |

Por distância (`mine_iron`, 4 válidas cada): d=1 → 1, d=2 → 0, d=4 → 0, d=6 → 0. Sem tendência coerente de proximidade
(a única escolha é d=1 com `continue_objective` listado primeiro; P(gather) em `wood` sozinho: d=1 0,53, d=2 0,17, d=4 0,34, d=6 0,27).

### Suplemento (fora do pedido; só para separar "limite de tokens" de "viés")

Como a 3ª combinação é inválida, rodei a mesma varredura trocando-a por `stone+iron` (2 materiais, cabe no limite):
`gsweep-supplement-stone-iron*.json`.

| Objetivo | `gather_materials` | Por ordem (gather 1º / continue 1º) | `stone+iron` |
|---|---|---|---|
| `explore` | 4/24 | 0/12 / 4/12 | 4/8, **todas com `continue_objective` listado primeiro** (P 0,50–0,87); com `gather_materials` primeiro: 0/4 |
| `mine_iron` | 8/24 | 3/12 / 5/12 | 7/8 (gather 1º: 3/4; continue 1º: 4/4) |

Ou seja, há sensibilidade ao **conteúdo** ("iron" na descrição puxa `gather_materials`, sobretudo em `mine_iron`), mas em
`explore` ela só aparece quando o candidato vem em 2º lugar; e a dependência de ordem continua.

## Critérios

1. `explore` passa a escolher `gather_materials`? **Não** nos cenários pedidos (runtime 0/17, offline 0/16). Só no suplemento
   `stone+iron`, e só com a ordem `continue_objective, gather_materials`.
2. Proximidade produz tendência coerente? **Não.** Runtime: 2 vs 5,7 blocos → mesma escolha (muda só a confiança). Offline: sem
   monotonicidade (ver acima; no suplemento `stone+iron`, `mine_iron` escolhe gather em d=1–4 e não em d=6 com gather primeiro).
3. `mine_iron` reduz a dependência da ordem? **Não demonstrável.** Com os cenários pedidos, 1/16 (era 19/84) e ainda só
   com `continue_objective` primeiro; no suplemento 3/12 vs 5/12 e a escolha de `explore` segue dependente da ordem (0/12 vs 4/12).
   Além disso o cenário pedido de 3 materiais deixou de funcionar (HTTP 400).

## Conclusão

**Viés persistente; o enriquecimento da descrição não o corrige** (explore ≈ 0%; mine_iron ainda dominado por ordem/palavras
da descrição, não por distância) e **introduz uma regressão**: descrição com 3 materiais excede o limite de 48 tokens e a
Julia fica sem decisão (HTTP 400 → breaker). Parado aqui conforme instruído: nenhum guardrail, nenhuma tentativa de corrigir
com mais prompt/descrição. Decisões em aberto para você: truncar/condensar a lista de materiais para caber em 48 tokens
(senão a mudança da PR #78 deve ser revista antes de qualquer merge) e tratar a escolha de `gather_materials` de forma
determinística/balanceando a ordem, como sugerido no relatório anterior.

## Arquivos

`ctx_groups.sh` (driver runtime), `gsweep2.js` / `gsweep2b.js` (varreduras principal e suplemento), `runtime_rows.py`
(consolida), `tee_proxy.py`/`probe.js` (instrumentação), `runtime/` (payloads, shadow, dispatch, journal, `rows.json`),
`gsweep-*.json`. Três ressalvas de execução: o jogador de teste `eduardo` precisou ser reiniciado (1ª tentativa sem despacho,
descartada); a 1ª decisão do G1 deu timeout por cold start do modelo.
