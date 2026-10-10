# Evidência do runtime Tool API — 2026-10-10

Base: `cdb848d` (PR #90). A CI dessa base foi consultada e retornou `completed/success`.

## Testes

- `npm run check`: exit 0; sintaxe adicional do harness verificada com `node --check`.
- `npm test`: **705/705**, zero falhas/skips/cancelamentos (`node-final.txt`).
- Suites Tool API runtime/server/layer, TaskCheckpointStore e reserva WorkerController: **52/52** (`targeted-final.txt`). Exercitam reserva antes de await, stop durante checkpoint, troca de dono durante readiness, morte/end mesmo com respawn, encerramento, replay de arquivos, origem/Host, IDs especiais e tipos inválidos.
- Python sidecars: **13/13** (`python-final.txt`).
- Gauntlet: **60 cenários determinísticos**, 100% sucesso, zero violações/escolhas inválidas. Modelos não executados (`gauntlet-summary.json`).

## Smoke final real

`MBOT_TEST_SERVER_JAR=/workspace/scratch/ed2352955755/mc-test/server.jar MBOT_TEST_EULA_ACCEPTED=1 node scripts/tool-api-live-smoke.js`.

JAR Mojang 1.20.1 verificado: SHA1 `84194a2f286ef7c14ed7ce0090dba59902951553`. Java 17. Servidor/clientes em subprocessos do mesmo harness; `index.js` real, WorkerController e executores reais. Não há stub de `run`, `gather`, `goto` ou inventário. Dados de aplicação e mundo novos num diretório temporário. Survival, peaceful, dia fixo, plataforma/árvore preparadas via console; bot sem OP, plugins opcionais e todos os modelos desligados.

| Fase | Resultado / evidência |
|---|---|
| Flag 0 | Worker entra no Minecraft; API recusa conexão e arquivo de checkpoints não existe |
| Flag 1 | API lista `ajudante_01` conectado com ferramentas reais |
| Coleta HTTP | Um oak_log coletado; executor registra inventário 0→1 e bloco-alvo `(0,71,0)` |
| Movimento HTTP | Posição observada `(5,71,0)` após destino `(6,71,0)`; dentro da tolerância de 2 blocos do executor |
| Replay | Mesmo task_id devolve `replayed:true`; inventário não ganha outro tronco |
| Origem externa | POST recebe 403 antes de executar |
| Busy/stop | Segunda ação recebe `worker_busy`; stop interrompe coleta; checkpoint fica cancelled, sem sucesso tardio |
| SIGTERM | Processo termina com código 0; listener fechado |
| Reinício | Worker restaurado; mesmo task_id reproduz resultado com attempts=1; cancelamento continua persistido |

Todas as nove fases passaram no smoke final (`report.json`, `live-output.log`). `app-1.log` é controle desligado (encerrado por SIGKILL para conservar o comportamento anterior), `app-2.log` habilitado e `app-3.log` reinício. `server.log` registra conexões, preparação e encerramento do mundo. Os mundos/JARs não estão versionados.

## Falhas preservadas e limites

O primeiro harness falhou antes de testar API: username de teste `tool_orchestrator` tinha 17 caracteres e o servidor só aceita 16. Relatório preservado em `failed-harness-setup.json`; a mensagem do servidor foi `The received string length is longer than maximum allowed (17 > 16)`. O fixture foi corrigido para `tool_main`. O segundo smoke passou; a execução final foi repetida após limpeza dos listeners e também passou. A falha de preparação não foi classificada como regressão nem resultado aprovado.

Coleta, movimento e stop têm validação física neste ciclo. Craft, deposit, withdraw e eat têm cobertura de camada/executor existente, mas **não** novo smoke físico via HTTP. Não foi testado combate, fome sustentada, dois workers concorrentes ou soak natural. API confia nos processos locais e não oferece autenticação remota. Cancelamento não desfaz ações físicas já submetidas.
