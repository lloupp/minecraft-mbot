# Experimentos de decisão arquivados

Em 2026-10-31 a `main` passou a ter um único motor por modelo: **Julia-1**
(shadow ou autoridade com guardrails), além da política determinística padrão.
Os demais foram removidos da árvore. O código continua no histórico, no commit
`b00cb6d` (último com todos), e pode ser restaurado com:

```bash
git checkout b00cb6d -- <arquivo>
```

## Por que cada um saiu

Medição: Player Loop Gauntlet V2, 12 cenários × 5 repetições, CPU-only, timeout
de 4 s ([evidência `player-loop-v2-five-way`](EVIDENCE.md)).

| Motor | Sucesso conduzido pelo modelo | p95 | Decisão |
|---|---|---|---|
| Julia-1 | 30/35 | 330 ms | **Mantido**. Único a passar o gate; depois medido com autoridade em mundo real (`julia-authority-measured-1201`). |
| Laya | 35/35 | 2059 ms | Arquivado: não passou o gate de latência (p95 ≤ 2 s) e ocupa 3,2 GB de RAM. |
| Andy-4 (Ollama) | 0/35 | > 4000 ms | Arquivado: 50/50 timeouts. |
| NanoAndy-350M | 0/35 | > 4000 ms | Arquivado: 50/50 timeouts. |

## O que foi removido

- Laya: `lib/laya-shadow.js` (a mecânica virou `lib/shadow-observer.js`, usada
  pela Julia), `scripts/laya-decision-server.py`, `scripts/laya-shadow-report.js`,
  `scripts/requirements-laya.txt`, `docs/LAYA_*.md`.
- API de decisão v1 sem consumidor no runtime: `lib/decision-engine.js`,
  `core/DecisionCoordinator.js`, `lib/decision-benchmark.js`,
  `scripts/decision-gauntlet.js`, `data/decision-gauntlet.json`.
- Andy-4 / NanoAndy: `scripts/ollama-decision-server.js`,
  `scripts/nanoandy-decision-server.py`, `scripts/requirements-nanoandy.txt`,
  `docs/player-loop-model-comparison.md`.
- Sem consumidor: `lib/parallel-shadow.js`, `lib/shadow-fanout.js`.
- Os testes correspondentes e as variáveis `LAYA_*`, `ANDY_*`, `NANOANDY_*`,
  `MBOT_LAYA_SHADOW` e `MBOT_DECISION_ENGINE` do `.env.example`.

Para avaliar um modelo novo: implemente o mesmo contrato `/choose` do sidecar
da Julia e adicione o motor em `MODEL_ENGINES` de
`scripts/player-loop-gauntlet-v2.js`.
