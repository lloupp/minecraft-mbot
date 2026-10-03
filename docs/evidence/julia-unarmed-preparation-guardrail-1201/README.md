# Preparação determinística antes de continuar desarmado — Java 1.20.1

2026-09-30; PR #78; branch `experiment/julia-laya-andy-player-loop-v2`.
HEAD medido: `63010a24b5e394dc0d93786ef925f228c4f41aee`.

**Aprovado: 12/12 snapshots reais e 2/2 transições offline.**

| Caso | Resultado | Candidatos em todas as repetições |
|---|---|---|
| explore desarmado, madeira/pedra próximas | 3/3 | `[gather_materials]` |
| mine_iron, picareta válida equipada, sem arma | 3/3 | `[gather_materials]` |
| explore sem materiais próximos | 2/2 | `[continue_objective]` |
| materiais próximos + zombie real a 4 blocos | 2/2 | `[escape_danger]` |
| materiais próximos + fome crítica e comida próxima | 2/2 | `[find_food]` |

Nos seis casos de preparação, `continue_objective` não aparece. Sem materiais,
`nearby.wood/stone/iron=false` e há **0 escolhas gather**. A ameaça e a fome crítica
mantêm precedência sobre o novo guardrail.

Todas as decisões são candidatas únicas/forçadas. Observador Julia habilitado,
retorno `undefined`, **0 chamadas HTTP do shadow**: ele ignora singletons antes da rede.
Para demonstrar o contrato do sidecar separadamente, foram feitas 12 requisições
diagnósticas `/choose`, todas HTTP 200, `source=forced_single_candidate`,
`confidence=1`, `model_calls=0`, `latency_ms=0`.
O recorder na fronteira do engine real confirmou **0 chamadas a `engine.predict()`**.
Não se trata de 12 inferências bem-sucedidas: são 12 decisões que dispensam inferência.

**0 erros, timeouts e escolhas inválidas.** As projeções determinísticas via
`applyIntent` deram 0 `safetyViolation`; sob ameaça, `escape_danger` limpa a ameaça
sem incrementar exploração ou progresso. O bot real permaneceu sem tarefa de progresso.
Julia continuou com `executionAuthority="none"`; nenhuma decisão dela foi aplicada.

## Montagem e limites

Servidor vanilla Java **1.20.1**, Java 17.0.20; mundo isolado `guardrail-world`;
Mineflayer 4.42.2 conectado como `guardrail_probe`. Plataforma de terra em y=199;
materiais a 2 blocos detectados por `realStateSnapshot()`/`nearbySignals()` reais.
Inventário vazio, vida 20, sem arma equipada/carregada/craftable; para mine_iron,
uma `stone_pickaxe` válida foi dada e equipada, sem testar falta de ferramenta.
Base conhecida a 299,5 blocos. Food 20 exceto nos dois controles críticos (food 5).

Zombie real, NoAI, a 4 blocos, dificuldade normal e noite fixa. Sem ameaça no
controle crítico: uma cow real NoAI a 3 blocos foi detectada como comida, sem alimento
no inventário; efeito Hunger reduziu food a 5 e foi removido antes da captura.
Isso usa a semântica existente de comida detectada, não afirma que o bot já possui alimento.

A validação real cobre percepção, geração de candidatos e bloqueio da inferência;
não executa coleta, crafting, fuga ou alimentação no mundo. A reação/progresso e
transição de inventário são verificados pelo simulador `applyIntent` solicitado,
separadamente da sessão real. Portanto não comprova eficácia do executor dessas tarefas.
Servidor e sidecar foram encerrados ao final; não houve benchmark longo.

## Transição offline curta

Snapshots iniciais reais de ambos os objetivos:

`gather_materials` → `applyIntent` adiciona os materiais simulados → reavaliação
com `stone_sword` craftable → candidatos `[prepare_combat, continue_objective]`,
**sem gather** → política determinística escolhe `prepare_combat` →
`stone_sword` equipada → candidatos `[continue_objective]`.

As duas transições passaram, sem segunda coleta forçada e sem safety violations.
Essa projeção não equivale a uma receita craftada fisicamente no Minecraft.

## Verificações e evidência

Executados primeiro, na ordem pedida: checkout/pull (already up to date),
`npm run check` (OK), `node --test test/player-loop.test.js` (**12/12**),
`python -m unittest discover -s test -p 'test_julia_sidecar.py'` (**2/2**).
Scripts de evidência também passaram syntax/compile checks e `summarize.py`.

`rows.json`/`rows.csv`: estado real, entidades/distâncias, candidatos, escolhas
forçadas, model_calls, HTTP/latência/erros e projeção offline por repetição.
`sidecar-traces.jsonl`: request, candidatos normalizados, response e contador
de chamadas ao engine. `shadow-stats.json`: observer habilitado sem chamadas.
`offline-transitions.json` e `summary.json`: transições completas e gates.
Logs do servidor/sidecar/driver, comandos e `runtime-environment.json` incluídos.

Julia oficial carregada em CPU, snapshot `a85b127321d580d65176c89ced8273f305745d85`,
Python 3.12.14, torch 2.14.1+cpu, transformers 5.0.0; mesmos pesos/runtime do ciclo
`../julia-candidate-order-1201/` (checksums/dependências lá). Não houve inferência.

Reprodução: usar `run.js` com `ORDER_SERVER_DIR` apontando para um diretório isolado
com servidor 1.20.1 e EULA aceita, `ORDER_PYTHON` para o venv,
`JULIA_MODEL` para o snapshot e `ORDER_OUTPUT_DIR` para um destino novo.
Rodar depois `summarize.py` com o mesmo `ORDER_OUTPUT_DIR`.

Nenhuma alteração de produção nesta rodada. Main intocada, sem merge.
