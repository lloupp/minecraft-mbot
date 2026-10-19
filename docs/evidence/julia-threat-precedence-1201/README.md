# Precedência ameaça × fome crítica e sinais de rota — Minecraft Java 1.20.1

HEAD `5ad3606` de `experiment/julia-laya-andy-player-loop-v2`. `npm ci`, `npm run check`,
`python -m py_compile scripts/julia-decision-server.py` OK; `npm test` **421/421**.
Servidor vanilla 1.20.1 descartável, runtime real, Julia-1 (CPU) só em shadow
(`executionAuthority: "none"`), Laya/Andy desligados. Instrumentação de leitura em `probe.js`
(registra estado+candidatos de todo despacho, inclusive os de candidato único).

## 1. Precedência — PASSOU

Worker `explorador_01`, inventário sem comida, food 1–5, vaca (NoAI) a 2,0–7,5 blocos, base a ~10
(vaca mais perto que a base). 54 despachos, 21 linhas do shadow, 21 payloads ao sidecar.

| Cena (medida) | n | Candidatos | `find_food` forçado | Julia consultada | Escolha da Julia |
|---|---|---|---|---|---|
| **A** zumbi a 8–9 blocos (15 sem espada, 5 com) | 20 | `escape_danger` (15), `equip_best_weapon,escape_danger` (3), `fight_threat,escape_danger` (2) | **0** (`find_food` nem é candidato) | 5 (só os multi-candidato) | `equip_best_weapon` 3, `escape_danger` 2 |
| **B** mesma fome, zumbi removido | 6 | `find_food` (6) | 6 (`immediateSafety=find_food`) | **0** | — |

- Escolhas fora dos candidatos: 0. Erros 0, timeouts 0, safety violations 0, autoridade `none` 5/5.
- Latência da Julia (n=5): p50 383 ms, p95/máx 477 ms.
- Invariantes: 0 estados de 1 candidato chegaram ao sidecar; 0 estados multi-candidato sem linha do shadow.
- Os 7 payloads `find_food,return_base` são de food 6–8 (guardrail não se aplica; viés `return_base` já documentado).
- Limite: amostra pequena (B só 6), um worker, zumbi solitário. Os candidatos `escape_danger` único
  vêm da lógica de ameaça existente, não do guardrail.

## 2. `alternativeRoute` / `replan_route` — evidência INSUFICIENTE; campo mantido `false`

Sinais reais de falha existem no runtime:

| Sinal | Onde | Observado |
|---|---|---|
| `PATH_FAILED` ("No path to the goal!" / "caminho demorou demais") | `lib/gather.js`, `WorkerController.goToPoint` | **sim** (toras em gaiola de bedrock: 6 tentativas seguidas no mesmo pedido; 2 em outro, com timeout) |
| `RESOURCE_UNREACHABLE` | `lib/gather.js` (`canDigBlock`) | só no código |
| `NAVIGATION_POSITION_NOT_CONFIRMED` | `goToPoint` | só no código |

Achados (código + runtime), que impedem preencher o campo sem simular:

1. **Nenhum sinal de rota alternativa existe.** O pathfinder só devolve sucesso/`noPath`/timeout para
   um objetivo. O único "plano B" do runtime é `mineBlocks` pular para *outro bloco* (`skip`, com
   memória de 10 min) — isso é alvo alternativo, já executado dentro da própria coleta, não uma rota
   conhecida para o mesmo objetivo. Nada é guardado com o significado de "rota alternativa viável".
2. **`consecutiveFailures` não enxerga essas falhas.** `_shadowFailureStreak` só sobe quando a
   promise da tarefa *rejeita*; `gatherBlocks` devolve `{ok:false, code:'PATH_FAILED'}` (resolve) e
   zera o contador. Observado: após `PATH_FAILED`×6, os despachos seguintes do mesmo worker registraram
   `consecutiveFailures=0` (`route/probe-dispatch.jsonl`). Logo o ramo `≥3 falhas ⇒ replan_route/stop_task`
   é inalcançável a partir de falhas reais de navegação, com ou sem `alternativeRoute`.
3. Mesmo com `alternativeRoute=true` o candidato seria único (`replan_route`) e a Julia não seria consultada.

O que faltaria (não implementado): (a) contar `ok:false` (não cancelado) como falha no streak,
por objetivo/recurso; (b) uma prova objetiva de rota tentável, p.ex. um `pathfinder.getPathTo` com
`Movements` diferentes (`canDig`, parkour) que retorne `success` onde o padrão deu `noPath` — viabilidade
**não verificada** aqui. Sem (b), qualquer `true` seria inventado.

Ressalva do teste: gaiolas em plataforma a y=200; o harness de repetição foi ruidoso (rodadas 2–4
tiveram `RESOURCE_NOT_FOUND`/`CANCELLED` por posições lembradas e reenvio de ordem); só a rodada 1
(`route/round1-bot.log`, `route/rounds2-5-bot.log` primeiro bloco) é evidência limpa de `PATH_FAILED`.
`lenhador_02` afogou-se num teleporte de setup (irrelevante ao resultado).

Nenhum código do runtime foi alterado. Arquivos: `precedence/`, `route/`, `prec.sh`, `prec_analysis.py`, `probe.js`.
