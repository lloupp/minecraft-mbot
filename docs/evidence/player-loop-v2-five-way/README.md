# Player Loop V2 — rules × Laya × Julia-1 × Andy-4 × NanoAndy (real run)

Data: 2026-09-29. Base: PR #78 (`a550b84`). Dados brutos resumidos em `summary.json`
(gerado por `scripts/player-loop-summarize.py` a partir dos relatórios do runner).

## Ambiente

CPU-only, 4 vCPU, 16 GB RAM, sem GPU.

| Engine | Modelo / runtime |
|---|---|
| rules | `deterministicPlayerPolicy` (baseline de segurança, não é juiz) |
| Laya | `laya 0.3.21`, `USE_TF=0`, sidecar :8765 |
| Julia-1 | `SupersonicLabs/Julia-1` (snapshot HF em disco, `JULIA_MODEL=<dir>`), `device=cpu`, :8768 |
| Andy-4 | `sweaterdog/andy-4:micro-q8_0` via Ollama 0.34.4 (100% CPU, ctx 4096), :8767 |
| NanoAndy | `DedeProGames/NanoAndy-350M`, fp32 CPU, :8766 |

Mesmo estado (`compactState`), mesmos candidatos, mesmos 12 cenários, mesma ordem,
5 repetições (60 execuções/engine). Modelos só devolvem um id de candidato; qualquer id fora da
allowlist é rejeitado e cai no fallback determinístico. Executor e guardrails ficam em `lib/player-loop.js`.

## Método (e uma rodada descartada)

A primeira rodada rodou os 4 modelos intercalados no mesmo processo do runner. **Foi descartada**:
requisições abortadas por timeout (NanoAndy/Andy-4) continuam consumindo os 4 núcleos e
contaminaram a latência dos engines seguintes (Laya deu 49/50 timeouts, mas ocioso responde em ~1 s).
Os números abaixo vêm de rodadas **isoladas por engine** (só um sidecar recebe requisições; warm-up
não medido; 20 s de dreno entre rodadas; RSS amostrado a cada 1 s por processo).
Para Andy-4 e NanoAndy houve também rodada com timeout de 120 s (Andy-4: 1 repetição; NanoAndy: 2)
para separar "lento demais" de "incapaz".

## Resultados (timeout do runner = 4 s, 5 repetições)

"Sucesso conduzido pelo modelo" = cenários em que o modelo foi consultado, o cenário passou **e** não
houve nenhum fallback. O `success_rate` bruto do runner inclui sucessos obtidos pelo fallback de
rules e por isso não mede o modelo.

| Métrica | rules | Laya | Julia-1 | Andy-4 | NanoAndy |
|---|---|---|---|---|---|
| success rate (runner) | 100% | 100% | 91,7% | 100%* | 100%* |
| sucesso conduzido pelo modelo | n/a | 35/35 | 30/35 | **0/35** | **0/35** |
| violações de segurança | 0 | 0 | 0 | 0 | 0 |
| loops | 0 | 0 | 0 | 0 | 0 |
| escolhas inválidas | 0 | 0 | 0 | 0 | 0 |
| fallbacks (técnicos) | 0 | 0 | 0 | 50/50 (timeout) | 50/50 (timeout) |
| inferências confirmadas / requisições | – | 40/40 | 45/45 | 0/50 | 0/50 |
| timeouts | – | 0 | 0 | 50 | 50 |
| latência p50 / p95 | 0 | 1707 / 2059 ms | 291 / 330 ms | >4000 / >4000 ms (timeout) | >4000 / >4000 ms (timeout) |
| tempo mediano por cenário | ~0 | 1617 ms | 271 ms | 4001 ms | 4001 ms |
| RSS pico (MB) | – | 3203 | 1548 | 2263 (runner Ollama 2146 + serve 38 + proxy 79) | 4703 |
| retomada após interrupção | 10/10 | 10/10 | 10/10 | 10/10 (via fallback) | 10/10 (via fallback) |
| desvio de objetivo (`stop_task` fora de cancel) | 0 | 0 | **5** | 0 | 0 |
| `shadow_readiness` | – | **não** (p95 2059 > 2000 ms) | **sim** (gate do runner) | não | não |

\* 100% obtido integralmente por fallback determinístico.

### Com timeout de 120 s (o que os modelos lentos realmente fazem)

| | Andy-4 (1 rep., 10 req.) | NanoAndy (2 reps., 20 req.) |
|---|---|---|
| respostas válidas na allowlist | **0** | **0** |
| escolhas inválidas | 10 (fora da allowlist) | 18 (JSON ausente) |
| falha técnica | 0 | 2 (HTTP 400) |
| latência p50 / p95 | 6809 / 8107 ms | 5207 / 5547 ms |

## Conclusões objetivas

- **Julia-1 — utilizável, com ressalva.** Única que responde bem dentro do prazo (p95 330 ms, 0 timeout,
  0 fallback, 0 inválidas, 1,5 GB). Falha 1 cenário: em `repeated_failure_replan` escolhe `stop_task`
  (desiste) em 5/5 repetições, com confiança ≈1, em vez de `replan_route`. Isso é desvio de objetivo real
  e determinístico (não é "discordar de rules": abandona a tarefa em vez de tentar a rota alternativa).
  O gate do runner marca `ready`, mas o gate não capta esse desvio; **não** é seguro dizer "pronta para
  shadow" sem tratar esse cenário. Amostra pequena (35 cenários com decisão de modelo; 12 tipos).
- **Laya — funcional, lenta.** 35/35 sem fallback e sem desvio, mas p50 1,7 s / p95 2,06 s
  (reprova o gate de 2 s por 59 ms) e 3,2 GB de RSS. Utilizável só se o orçamento de 2 s for
  relaxado ou a inferência acelerada; é a mais correta, mas 6× mais lenta que a Julia-1.
- **Andy-4 micro-q8_0 — não utilizável neste contrato.** 5–8 s por chamada em CPU (estouro do timeout
  em 100% das requisições) e, com timeout folgado, 0/10 respostas dentro da allowlist: com `format: json`
  emite texto degenerado; sem `format` responde em prosa. Seu 100% de "sucesso" é todo do fallback.
  Foi treinado para comandos do Mindcraft, não para escolher um id entre candidatos.
- **NanoAndy-350M — não utilizável.** ~5 s por chamada em CPU e 4,7 GB de RSS (o maior); 0/20 saídas
  válidas mesmo sem timeout (não produz o JSON pedido). Também 100% de "sucesso" por fallback.

Nenhum modelo foi escolhido por concordância com rules. Nenhum modelo teve violação de segurança ou loop;
os guardrails determinísticos cobrem os cenários críticos (fome, creeper, cancelamento), que não consomem
o modelo.

## Limitações

- CPU de 4 vCPU; em GPU/HW melhor a latência de Laya/Andy-4/NanoAndy mudaria (a qualidade de saída não).
- 5 repetições de cenários determinísticos (temperatura 0): repetições medem latência/estabilidade,
  não variedade de estados. Só 35 de 60 execuções/engine chegam a consultar o modelo.
- Rodadas de 120 s: 1–2 repetições. Latência do Andy-4 varia (0,9 s no smoke test curto vs 5–8 s com o estado real).
- Julia-1 foi instalada a partir de snapshot do Hugging Face (`git clone` do repo falhou pelo proxy);
  `requirements-julia.txt` usa `git+https://huggingface.co/...` e não funciona nesse ambiente.
  Para rodar o sidecar é preciso `JULIA_MODEL=<caminho local>`; com o default `Julia-1` ele falha
  (`FileNotFoundError: Julia-1/encoder/config.json`).
- O RSS reportado pelo sidecar Andy é do proxy Node (~75 MB), não do Ollama; RSS acima foi amostrado por `ps`.
- Sidecar NanoAndy classifica JSON malformado do modelo como HTTP 400 `invalid_request` (o `JSONDecodeError`
  é `ValueError`), contando como fallback técnico em vez de escolha inválida.
- Requisições abortadas por timeout continuam executando no sidecar (NanoAndy chama `generate` fora do lock);
  isso deve ser tratado antes de qualquer uso em paralelo.
- `npm test`: 2 falhas de `viewer-follow` e `dashboard.test.js` travado por dependência nativa (canvas/GL)
  não construída (`npm ci --ignore-scripts`); demais 359/361 passam. Sem relação com esta PR.
