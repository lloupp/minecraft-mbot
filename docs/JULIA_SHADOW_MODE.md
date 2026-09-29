# Shadow mode da Julia-1

A Julia-1 observa as decisões reais do runtime **sem autoridade de execução**.
É o mesmo padrão do Laya (`docs/LAYA_SHADOW_MODE.md`): `lib/julia-shadow.js`
estende `LayaShadowObserver`, herdando fire-and-forget, timeout, limite de
concorrência, disjuntor e validação da escolha contra a máscara de candidatos.

## Como ligar

```bash
# sidecar (fora do processo do bot; ver scripts/requirements-julia.txt)
JULIA_MODEL=<pasta-ou-id-do-modelo> python scripts/julia-decision-server.py
# runtime
MBOT_JULIA_SHADOW=1 JULIA_PLAYER_LOOP_URL=http://127.0.0.1:8768/choose npm start
```

Desligado por padrão. Laya e Julia são independentes (`lib/shadow-fanout.js`).

## Garantias

- `observe()` sempre devolve `undefined`; a escolha da Julia nunca chega ao executor.
- Nunca é `await`ado; erro/timeout do sidecar vira uma linha de log, não exceção.
- Estados com 0 ou 1 candidato (nada a decidir, ex.: guardrails de segurança)
  não são enviados à Julia.
- Toda linha tem `executionAuthority: "none"`.

## Registro por decisão (`JULIA_SHADOW_LOG`, tipo `julia_shadow_decision`)

`state`, `objective`, `candidates`, `executedChoice` (tarefa real), `juliaChoice`,
`juliaConfidence`, `latencyMs`, `juliaError` (`timeout`, `http_*`,
`invalid_choice`...), `rulesChoice`/`agreesWithRules` (regras = 1º candidato, como
no Gauntlet), `realIntent`/`agreesWithReal` (só quando a tarefa real mapeia
inequivocamente para uma intenção; senão `null`), `safetyCritical`,
`safetyOverride` (sob ameaça a Julia divergiria das regras ⇒ prevalece o
reflexo determinístico), `wouldViolateSafety` (regra do Gauntlet V2 sobre o
estado registrado), `wouldAbandonObjective`/`unjustifiedAbandon`,
`objectiveType`, `resumedObjective`, `interrupted`, `result` e `nextState`
(resultado da ação real).

`npm run julia-shadow:report` calcula as métricas e os critérios de prontidão
(≥500 decisões, ≥2 h, 0 violações, 0 fora da máscara, 0 abandonos indevidos,
0 loops, p95 < 2 s, disponibilidade ≥ 98 %, autoridade `none`).

## Limitações conhecidas

- Só `WorkerController.run` é observado; ações do bot principal (`!minerar`,
  `!fabricar`, `!seguir`...) não geram decisão.
- `lib/real-state.js` não preenche `nearby` nem `alternativeRoute`: coleta,
  crafting, retorno simples e falha de rota costumam ter 1 candidato (sem
  decisão para observar). Isso limita a cobertura a ameaça, preparo de
  combate e fome (nível 9–10).
- `agreesWithRules` usa "primeiro candidato" como regra, como o Gauntlet V2.
