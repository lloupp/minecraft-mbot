# EmbeddingGemma 2 — memória episódica (benchmark offline, Minecraft 1.20.1)

`executionAuthority = none`. Nenhuma ação Mineflayer foi executada; nada no runtime foi alterado.

**Veredito: NEUTRO.** EmbeddingGemma 2 recupera experiências bem melhor que recência e que TF-IDF, mas
**não supera** um rule match estruturado barato (com preferência por resultado positivo). Ele custa ~1,2 GB de RAM e ~96 ms
de CPU por consulta, contra ~2 ms do rule match. Pelo gate do experimento, **não foi feita integração online/shadow**.

## Modelo e ambiente

- `google/embeddinggemma-2`, revisão `914f7f89142e33e77833254d9c9b90c3cef7303b`, carregado localmente em CPU, só texto
  (`vision_config=None, audio_config=None`). Prompts: `SearchQuery` (estado atual) e `Document` (episódio histórico).
- Intel Xeon @ 2.10GHz, 4 vCPU, 16,9 GB RAM, Linux 6.18, Python 3.13.16, torch 2.14.1+cpu, transformers 5.19.0,
  sentence-transformers 6.1.0. Detalhes em `environment.json`.
- Carga do modelo: ~5 s. RSS 568 MB → 1174 MB após a carga (+~600 MB); pico de 2,4 GB ao indexar a frio ~21 mil textos.
- Encode de uma query: p50 96 ms, p95 124 ms (CPU, batch 1). Busca no índice (≤2.109 vetores): p50 0,3 ms (256d).

## Corpus (`corpus-stats.json`)

Todos os logs `julia_authority_cycle` / `julia_shadow_decision` com `result` versionados em `docs/evidence/` (50 arquivos,
18 runs reais de PR #88 e anteriores), deduplicados, com IDs prefixados pelo run.

| | n |
|---|---|
| episodes_total | 2109 |
| contested_decisions (2+ candidatos) | 294 (143 ok / 151 falha) |
| forced_decisions (1 candidato) | 1815 — ficam na memória, não são pontuadas |
| avaliadas (contested com ≥3 episódios passados) | 291 |

Ações contestadas: sleep_or_shelter 102, return_base 78, continue_objective 53, prepare_combat 22, escape_danger 18,
equip_best_weapon 18, find_food 2, fight_threat 1. Categorias contestadas (derivadas só do estado/candidatos):
PREPARATION 141, THREAT 48, SHELTER 41, FOOD 38, NAVIGATION 26. Não há episódios contestados de GATHER/EXPLORATION
(nesses casos a decisão foi sempre forçada).

## Regras anti-vazamento

- Query = estado no momento da decisão + candidatos. Nunca contém ação escolhida, `juliaChoice`, `rulesChoice`,
  `deterministicChoice`, `result`, `nextState`, código ou sucesso (teste de invariância em
  `test/embedding-memory-corpus.test.js`).
- Temporal: para a decisão N, só é recuperável episódio com `settledAt < decidedAt(N)` — nem o próprio, nem futuros, nem
  ações concorrentes ainda em execução (testes JS e Python).
- Shadow: rótulo = intenção realmente executada (`realIntent`), não a escolha observada do Julia.

## Resultados (291 decisões contestadas, top-k = 3)

`memoryUtility@3`: média nos top-3 de +1 (mesma ação, resultado positivo), +0,5 (outra ação disponível agora, positiva),
−0,5 (falha/cancelada/bloqueada), −1 (safety ou perda de vida), −0,25 (ação indisponível agora), −0,25 extra se a
categoria difere. "Positivo" exclui `SAFETY_PRECEDENCE`, cancelamentos, preempções, bloqueios e perda de vida.

| Configuração | Top1 | Hit@3 | Useful@3 | MRR | Utility@3 | busca p50 | RAM / índice |
|---|---|---|---|---|---|---|---|
| Random | 0.213 | 0.450 | 0.227 | 0.384 | −0.371 | — | — |
| Recency | 0.536 | 0.756 | 0.330 | 0.659 | −0.247 | 0.01 ms | — |
| Rule Match | **0.873** | 0.924 | 0.495 | **0.903** | 0.054 | 1.5 ms | — |
| Rule Match + outcome | 0.869 | **0.928** | **0.519** | 0.902 | 0.194 | 1.9 ms | — |
| TF-IDF (texto completo) | 0.773 | 0.904 | 0.505 | 0.844 | 0.067 | 49 ms | — |
| TF-IDF (compact) | 0.777 | 0.873 | 0.450 | 0.835 | 0.107 | 34 ms | — |
| Gemma 128d (completo) | 0.629 | 0.739 | 0.337 | 0.705 | −0.188 | 96 ms encode + 0.26 ms | 1.1 MB |
| Gemma 256d (completo) | 0.680 | 0.835 | 0.419 | 0.766 | −0.069 | +0.43 ms | 2.2 MB |
| Gemma 512d (completo) | 0.612 | 0.821 | 0.416 | 0.727 | −0.091 | +0.57 ms | 4.3 MB |
| Gemma 768d (completo) | 0.622 | 0.797 | 0.392 | 0.723 | −0.151 | +0.76 ms | 6.5 MB |
| Gemma 128d (compact) | 0.766 | 0.818 | 0.433 | 0.803 | 0.187 | +0.24 ms | 1.1 MB |
| **Gemma 256d (compact)** | 0.839 | 0.880 | 0.495 | 0.871 | **0.224** | +0.32 ms | 2.2 MB |
| Gemma 512d (compact) | 0.842 | 0.890 | 0.505 | 0.876 | 0.204 | +0.56 ms | 4.3 MB |
| Gemma 768d (compact) | 0.845 | 0.887 | 0.505 | 0.877 | 0.203 | +0.68 ms | 6.5 MB |

Gemma: ~600 MB de RAM do modelo em todos os casos; índice = 2109 × dim × 4 bytes.

### Diferenças pareadas (bootstrap 95%, Gemma 256d compact − baseline)

| vs | Top1 | Useful@3 | Utility@3 |
|---|---|---|---|
| Recency | +0.302 [0.241, 0.364] | +0.165 [0.113, 0.217] | +0.471 [0.410, 0.535] |
| TF-IDF compact | +0.062 [0.014, 0.110] | +0.045 [0.003, 0.086] | +0.117 [0.064, 0.171] |
| Rule Match | −0.034 [−0.076, 0.003] | 0.000 [−0.038, 0.034] | +0.170 [0.129, 0.210] |
| Rule Match + outcome | −0.031 [−0.065, 0.003] | −0.024 [−0.058, 0.010] | +0.030 [−0.001, 0.063] |

O ganho de utility sobre o rule match simples vem de preferir episódios com desfecho positivo; um rule match que faz o
mesmo (+0,5 para episódio positivo) empata com o Gemma.

### Viés de seleção

A representação `compact` foi escolhida depois de ver as ablações. Metade cronologicamente posterior das queries
(n = 146, `summary.json → heldoutSecondHalf`): Gemma 256 compact top1 0.808 / useful 0.644 / utility 0.452 contra
Rule Match + outcome 0.856 / 0.699 / 0.444. Conclusão igual.

### Por categoria (Gemma 256 compact vs Rule Match + outcome; top1 / useful@3 / utility@3)

| Categoria | n | Gemma | Rule+outcome | Recency |
|---|---|---|---|---|
| PREPARATION | 138 | 0.855 / 0.130 / −0.271 | 0.884 / 0.188 / −0.260 | 0.732 / 0.058 / −0.431 |
| THREAT | 48 | 0.625 / 0.563 / 0.387 | 0.667 / 0.542 / 0.234 | 0.313 / 0.333 / −0.299 |
| SHELTER | 41 | 0.976 / 0.976 / 0.927 | 0.976 / 0.976 / 0.937 | 0.342 / 0.610 / −0.144 |
| FOOD | 38 | 0.921 / 0.947 / 0.654 | 0.921 / 0.895 / 0.533 | 0.184 / 0.684 / 0.009 |
| NAVIGATION | 26 | 0.808 / 0.885 / 0.811 | 0.923 / 0.962 / 0.856 | 0.731 / 0.808 / 0.289 |

Em THREAT e FOOD o Gemma tem utility um pouco maior, mas com n = 48 e n = 38 isso não sustenta uma conclusão.

### Ablação (256d; Gemma top1 / useful@3 / utility@3, TF-IDF entre parênteses)

| Representação | Gemma | TF-IDF |
|---|---|---|
| full | 0.680 / 0.419 / −0.069 | (0.773 / 0.505 / 0.067) |
| no_inventory | 0.711 / 0.454 / −0.020 | (0.773 / 0.495 / 0.058) |
| no_candidates | 0.302 / 0.327 / −0.146 | (0.557 / 0.333 / −0.174) |
| no_distances | 0.670 / 0.412 / −0.049 | (0.753 / 0.502 / 0.054) |
| compact (buckets de vida/fome/ameaça + candidatos) | **0.839 / 0.495 / 0.224** | (0.777 / 0.450 / 0.107) |

O conjunto de candidatos é o sinal mais forte: sem ele, tudo cai. Texto numérico detalhado (coordenadas, distâncias,
inventário) piora o embedding. A representação útil é pequena e discreta, que é justamente o que um matcher estruturado
já captura.

Dimensões: 256d é a menor que preserva a qualidade (512/768 não melhoram; 128d perde ~7 pontos de top1).

## O que não foi feito (e por quê)

- Shadow online (`MBOT_EMBEDDING_MEMORY`), ExperienceMemory, cache incremental em runtime, Julia ± memória e smoke
  físico: **não feitos**. O gate exigia benefício sobre alternativas baratas; os dados não mostram isso. Ver `OMITTED.txt`.
- Ação "mesma do Julia" é proxy: o rótulo é a escolha do Julia (authority), não a ação ótima.
- Corpus pequeno e enviesado: 291 decisões contestadas, 47% PREPARATION, sem GATHER/EXPLORATION contestados.

## Reproduzir

```bash
node scripts/export-embedding-memory-corpus.js --all-evidence > .data/corpus.json
uv run scripts/embeddinggemma2-memory-benchmark.py --corpus .data/corpus.json --output-dir .data/bench
```
