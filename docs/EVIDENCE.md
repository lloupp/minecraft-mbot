# Evidências de execução real

As evidências brutas (logs, traces, JSON de rodadas no Minecraft real) saíram
da árvore principal: eram ~80% dos arquivos do repositório (16 MB). Continuam
no histórico do git e acessíveis por link permanente no commit
`b00cb6d`.

Para recuperar localmente:

```bash
git checkout b00cb6d -- docs/evidence/<pasta>
```

Novas evidências: anexe ao PR (artefato do CI ou comentário) e registre aqui
só o resumo e o link. Não commite logs brutos.

| Pasta | Assunto |
|---|---|
| [P0-2026-09-27.md](https://github.com/lloupp/minecraft-mbot/blob/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/P0-2026-09-27.md) | P0 — auditoria inicial e integridade do estado |
| [collection-p0](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/collection-p0) | P0 — coleta física em Forge 1.20.1 |
| [colony-planner-explore-preparation-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/colony-planner-explore-preparation-1201) | Preparação de `explorar` dirigida pelo DemandPlanner/ColonyOrchestrator — Minecraft 1.20.1 |
| [craftinternal-event-loop-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/craftinternal-event-loop-1201) | `craftInternal` sem bloqueio do event loop (#79 / PR #80) — 1.20.1 |
| [deterministic-material-preparation-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/deterministic-material-preparation-1201) | Guardrail acionável e preparação física determinística — Java 1.20.1 |
| [deterministic-preparation-defense-handoff-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/deterministic-preparation-defense-handoff-1201) | Defesa → preparação e reconnect — Minecraft Java 1.20.1 |
| [deterministic-preparation-drop-recovery-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/deterministic-preparation-drop-recovery-1201) | Recuperação limitada de drop e queda de transporte — Minecraft Java 1.20.1 |
| [deterministic-preparation-interruption-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/deterministic-preparation-interruption-1201) | Deterministic preparation interruptions — Minecraft Java 1.20.1 |
| [deterministic-preparation-moving-threat-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/deterministic-preparation-moving-threat-1201) | Preparação determinística — ameaças móveis e mutações, Minecraft 1.20.1 |
| [deterministic-preparation-preflight-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/deterministic-preparation-preflight-1201) | Preflight físico de preparação — Minecraft Java 1.20.1 |
| [deterministic-recovery-safety-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/deterministic-recovery-safety-1201) | Safety e identidade do drop durante recovery — Minecraft Java 1.20.1 |
| [explore-preparation-integration-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/explore-preparation-integration-1201) | Integração opt-in explorar → preparação determinística — Minecraft Java 1.20.1 |
| [forge-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/forge-1201) | Provisionamento Forge e primeiro smoke — 2026-09-27 |
| [julia-alternate-target-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/julia-alternate-target-1201) | Evidência de alvo alternativo do `gather` — 1.20.1 |
| [julia-authority-measured-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/julia-authority-measured-1201) | Julia-1 com autoridade, medida contra um controle: base com cama, abrigo noturno, fatos para a Julia, vigia de progresso |
| [julia-authority-real-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/julia-authority-real-1201) | Julia-1 com autoridade real no player loop — Minecraft Java 1.20.1 |
| [julia-authority-sustainability-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/julia-authority-sustainability-1201) | Julia-1 com autoridade: comida, noite, equipar sob ameaça e navegação — r4 contra a baseline r3 |
| [julia-candidate-order-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/julia-candidate-order-1201) | Julia-1: neutralização da ordem upstream — Minecraft Java 1.20.1 |
| [julia-critical-hunger-guardrail-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/julia-critical-hunger-guardrail-1201) | Guardrail de fome crítica — validação em Minecraft Java 1.20.1 |
| [julia-failure-streak-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/julia-failure-streak-1201) | Streak de falhas resolvidas (`ok:false`) e prova de rota alternativa — 1.20.1 |
| [julia-gather-bias-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/julia-gather-bias-1201) | A Julia-1 evita `gather_materials` por falta de contexto ou por viés? — 1.20.1 |
| [julia-gather-context-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/julia-gather-context-1201) | Descrição enriquecida de `gather_materials` muda a Julia-1? — 1.20.1 |
| [julia-gather-recovery-summary-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/julia-gather-recovery-summary-1201) | Resumo de recuperação determinística do `gather` — 1.20.1 |
| [julia-proximity-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/julia-proximity-1201) | Julia-1 × distância da comida e da base (fome) — Minecraft Java 1.20.1 |
| [julia-shadow-coverage-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/julia-shadow-coverage-1201) | Julia-1 shadow mode — validação de cobertura em Minecraft Java 1.20.1 |
| [julia-shadow-real-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/julia-shadow-real-1201) | Julia-1 em shadow mode real — Minecraft Java 1.20.1 |
| [julia-streak-semantics-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/julia-streak-semantics-1201) | Semântica de `consecutiveFailures` (por objetivo, cancelamento neutro) — 1.20.1 |
| [julia-threat-precedence-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/julia-threat-precedence-1201) | Precedência ameaça × fome crítica e sinais de rota — Minecraft Java 1.20.1 |
| [julia-unarmed-preparation-guardrail-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/julia-unarmed-preparation-guardrail-1201) | Preparação determinística antes de continuar desarmado — Java 1.20.1 |
| [live-readiness-20261027](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/live-readiness-20261027) | Validação real: conexão local e recuperação de auxiliares |
| [local-staging-and-pickup-nook-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/local-staging-and-pickup-nook-1201) | Staging local, pickup em nicho e soak do modo automático — Minecraft 1.20.1 |
| [natural-terrain-night-death-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/natural-terrain-night-death-1201) | Terreno natural, noite, morte, perda de espada e monitor de staging — Minecraft 1.20.1 |
| [natural-two-worker-20261011](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/natural-two-worker-20261011) | Execução real e limites |
| [navigation-five](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/navigation-five) | Gate de chegada física — cinco rodadas em Forge |
| [navigation-fix](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/navigation-fix) | Navegação com posição confirmada — 2026-09-27 |
| [player-loop-v2-five-way](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/player-loop-v2-five-way) | Player Loop V2 — rules × Laya × Julia-1 × Andy-4 × NanoAndy (real run) |
| [pr1-runtime-stability-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/pr1-runtime-stability-1201) | Lote 1 (fix/runtime-autonomy-stability) — validação física em Minecraft 1.20.1 |
| [pr3-julia-shadow-smoke-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/pr3-julia-shadow-smoke-1201) | Julia shadow (observe-only) — smoke no Minecraft 1.20.1 |
| [shelter-memory-integrity-20261010](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/shelter-memory-integrity-20261010) | Evidência — integridade e segurança, 2026-10-10 |
| [staging-threat-monitor-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/staging-threat-monitor-1201) | Monitor de ameaça durante o staging — Minecraft 1.20.1 (HEAD f9f24de) |
| [tool-api-runtime-20261010](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/tool-api-runtime-20261010) | Evidência do runtime Tool API — 2026-10-10 |
| [world-memory-1201](https://github.com/lloupp/minecraft-mbot/tree/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/world-memory-1201) | — |
