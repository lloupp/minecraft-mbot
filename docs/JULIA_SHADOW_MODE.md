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

## Concorrência, aquecimento e reinício

- `JULIA_SHADOW_MAX_CONCURRENT` (padrão 1, herdado do Laya) **descarta** decisões
  que chegam com uma chamada em voo. Com vários workers despachando juntos isso
  derrubou a disponibilidade para ~65 % numa sessão real; com `=4` foi 100 %
  (o sidecar serializa, então o excesso vira fila curta). Use 4 com 5+ workers.
- A 1ª inferência após subir o sidecar estoura o timeout de 4 s (cold start).
  Aqueça o sidecar (algumas chamadas a `/choose`) antes de ligar o runtime.
- O `taskLineageId` (`<worker>:<n>`) reinicia a cada processo; não compare
  linhagens entre execuções.

## Percepção `nearby` e linhagem

`lib/real-state.js` amostra 125 posições com `bot.blockAt` (raio 4, passo 2,
y −2..+2) e entidades até 8 blocos, só no instante da captura (sem
`findBlock/findBlocks`). Custo medido: ~0,02 % do CPU do runtime. `stone`
costuma ser verdadeiro na superfície (camada de pedra a ≤ 2 blocos).

`taskLineageId` liga uma tarefa reemitida após interrupção à mesma linhagem;
`resumedObjective` marca a retomada. O relatório conta `loops` só dentro da
mesma linhagem com chave estrita (inclui distância da ameaça e fome, logo quase
nunca repete) e reporta `repeated_order_streaks` e, como diagnóstico,
`max_lineage_identical_streak` (chave relaxada). `active_hours` soma
intervalos ≤ 10 min entre decisões.

## Limitações conhecidas

- Só `WorkerController.run` é observado (não o bot principal).
- `alternativeRoute` e `waitReason` continuam neutros: sem evidência do runtime,
  o ramo de falha de rota (`replan_route`) segue **sem cobertura**.
- Decisões só existem com ≥ 2 candidatos; coleta simples, crafting e retorno
  sem fome geram 1 candidato e não são avaliados.
- `agreesWithRules` usa "primeiro candidato" como regra, como o Gauntlet V2.
