# Recuperação limitada de drop e queda de transporte — Minecraft Java 1.20.1

Referência: `b02f891e8224cdc40e107145a92d6fce966edcf8`, PR #78,
branch `experiment/julia-laya-andy-player-loop-v2`. Servidor Java 1.20.1 local,
Java17, mundo isolado `drop-recovery-world`, Mineflayer e WorkerController reais.
Julia oficial carregada em CPU, snapshot
`a85b127321d580d65176c89ced8273f305745d85`, somente shadow. Preparação opt-in
ativada apenas no harness. Nenhum dispatch/reconnect/resume automático no produto.
Sem alteração de main, merge, persistência complexa ou benchmark longo.

## Recuperação física comprovada

| Cenário | Captura | Resultado real |
|---|---|---|
| Dig → quit antes do pickup → nova sessão | `baseline-basic/` | Inventário do servidor com 0 cobblestone; alvo (0,200,2) air; drop cobblestone real próximo; segunda pedra (2,200,0) presente. `recover_drop`, approvedTarget (0,200,2), delta1, inventoryConfirmed=true. Plano2→1, uma pedra adicional coletada, craft/equip stone_sword, continue_objective. |
| Pickup inacessível | `verification/blocked` | Drop original cercado por bedrock, alvo continua air. Tentativa de recovery: delta0, inventoryConfirmed=false; inventário0, remainingPlan2; APPROVED_TARGETS_INSUFFICIENT, nenhum dig adicional. |
| Dois drops de cobblestone | `baseline-controls/ambiguous` | Duas entidades reais separadas dentro do raio; recuperação recusada, sem goto/recovery/dig da nova sessão; inventário0, plano2. |
| Item errado (dirt) | `baseline-controls/wrong` | Ignorado; nenhuma recuperação/movimentação; inventário cobblestone0, plano2. |
| Cobblestone além de 2 blocos | `baseline-controls/outside` | Ignorado, sem busca global ou goto; inventário0, plano2. |
| Drop correto + dirt | `baseline-controls/mixed` | Só cobblestone foi candidato; pickup cobblestone0→1 confirmado; coleta apenas1 restante; espada equipada. Dirt1 entrou incidentalmente no inventário por pickup automático do Minecraft ao passar perto. Não foi candidato nem crédito de cobblestone. |
| Mesa fora do alcance | `baseline-controls/table` | Mesa próxima removida, outra colocada em (12,200,12). NEARBY_TABLE_REQUIRED antes da recuperação/coleta, inventário preservado; não ampliamos raio nem fabricamos/colocamos mesa. |

Não foi injetado cobblestone no inventário. O cenário básico usa exclusivamente o
drop produzido pelo dig real. Os controles de ambiguidade/item errado/fora do raio
substituem ou acrescentam entidades de item no mundo pelo console, conforme o teste;
não simulam pickup. Cada conexão nova lê playerdata/pacotes do servidor.

Todas as preparações entraram por `WorkerController.run` com objective `explorar`
e allowlist explícita dos dois blocos. A task retornada/reevaluada seguinte foi
submetida manualmente para craft/equip; não houve ligação da política ao fluxo normal.

## Quedas abruptas

| Ponto | Captura de referência | Estado reconstruído e retomada |
|---|---|---|
| Socket destruído durante dig | `final-buffered-transport/abrupt_dig` | Pacote block_dig status0 registrado; corte ~100 ms depois com targetDigBlock ativo. Sessão antiga retornou DISCONNECTED. Nova sessão: cobblestone0, ambas pedras ainda existentes, plano2; coletou2, craft/equip e continue_objective. |
| Socket destruído após air/drop, sem pickup confirmado | `baseline-abrupt/abrupt_pickup` | Antes do corte: alvo air, entidade cobblestone observável, inventário cliente0. Após reconnect: servidor confirmou inventário0 e drop presente; recover_drop delta1; plano2→1; coletou apenas segunda pedra; craft/equip e continue_objective. |
| Servidor SIGKILL durante dig | `final-buffered-transport/server_crash` | Corte depois do pacote de início, dig ativo. Servidor iniciado novamente manualmente, sem reconexão automática no produto. Sessão antiga DISCONNECTED; nova instância reconstruiu inventário0 e mundo com duas pedras; plano2 e preparação concluída. |

Antes de SIGKILL foi feito `save-all flush` do fixture inicial. Este teste não
promete durabilidade de alterações ainda não salvas, nem recuperação de um craft
submetido durante crash. O estado após restart, e não o plano antigo, determinou
as quantidades da nova tarefa.

Promises antigas encerraram; currentTask antigo ficou null e taskVersion foi
invalidado. Nenhum novo dig/craft/equip/place/goto começou depois do pedido de
corte na sessão velha. Na prova final, nenhum novo pacote de start/finish de dig
(status0/2) foi tentado depois do corte. Mineflayer ainda tentou **status1 de
cancelamento** no transporte morto ao abortar o dig já em andamento; isso está
registrado, não escondido, e não é uma nova coleta nem chegou ao servidor novo.
Não oferecemos garantia de rollback/abort atômico de operação já submetida.

## Ajuste pequeno e falhas preservadas

A lógica física de recovery do HEAD de referência passou. Fizemos apenas uma
correção de evidência no executor: a recovery ocorre antes do preflight; se esse
preflight recusa, o retorno antigo descartava `steps` já registrados. No teste de
pickup bloqueado havia tentativa delta0 na timeline, mas o resultado continha
somente code/initial/plan. O retorno agora preserva steps, final e remainingPlan
lidos do inventário real também nas três recusas posteriores à recovery.
`verification/blocked` comprova o resultado corrigido; a captura anterior continua
em `baseline-controls/`. Não mudamos seleção, raio, quantidade ou autoridade.

A primeira parada total de servidor em `baseline-abrupt/server_crash` produziu
ECONNRESET. A espera do harness usava events.once(end), que rejeita quando ocorre
error antes de end; por isso o harness falhou antes de reconnect. O worker não
precisou de correção: mudamos a espera de teste para observar end sem confundir o
erro esperado de transporte com falha de setup. Captura original preservada.

As primeiras sondas de dig cortavam o socket logo na chamada bot.dig, antes do
pacote de início; não são usadas como prova da janela de dig efetiva. A sonda foi
ajustada para o pacote status0 +100 ms (somente agendamento de teste, nenhum sleep
no código de produção), com digInFlight explicitamente registrado.

`transport-window-verification/` e `final-transport-window/` tiveram seis lacunas
no arquivo de append (seq51–56); estão preservados como capturas incompletas e não
são base para prova de ausência de ações. A causa desse comportamento de append
não foi estabelecida. O recorder final guarda cada evento serializado em memória
no instante da observação e salva essa sequência completa ao encerrar. Em
`final-buffered-transport/`, timeline.jsonl tem **175 eventos contínuos**;
`timeline-append.jsonl` preserva o append com lacunas e recorder_integrity registra
appendMissing e bufferMissing=[] separadamente. Nenhum evento foi reconstruído,
inferido ou copiado de outra execução.

## Testes, auditoria e limites

- `npm run check`: aprovado.
- Forced preparation/worker: **32/32**.
- `npm test`: **470/470**.
- Python Julia sidecar: **2/2**.
- `python .../summary.py`: **29/29** verificações das capturas reais gravadas.
- CI #281 e StateMachine #90 do HEAD de referência verdes; CI do commit publicado
  registrado na atualização da PR.

Logs/exit codes em `tests*.log`/`tests.json`. SHA256 do código usado, metadados,
harness-source.txt exato, resultados, inventário, drops, packets, ownership e
console do servidor estão em cada pasta. Raw errors e recusas foram mantidos.
Não alegamos zero falhas em todas as tentativas exploratórias.

Zero digs não autorizados e nenhuma sobreposição física de preparação observada
nas capturas auditadas. Julia não executou nada; singleton determinístico não
precisa de inferência. Não houve alteração de prompts/descrições.

Antes de integrar ao fluxo normal ainda falta validar safety/nova ordem durante
o próprio pickup limitado, mudanças de drop entre seleção e movimento e outras
janelas de crash (craft/save/pickup já confirmado). Um único drop próximo é uma
condição limitada plausível; não prova identidade/proveniência histórica sem
correlação cross-session, que não foi criada. Pickup automático incidental de
outros itens também permanece possível. Mesa/material fora dos limites continuam
exigindo recusa ou uma nova ação explícita, sem ampliar raio automaticamente.

## Reprodução curta

Prepare Java17, servidor oficial/EULA 1.20.1, snapshot Julia e dependências conforme
runtime-environment.json. Mundo isolado obrigatório: o fixture limpa plataforma e
inventário dos bots de teste. Por exemplo:

```bash
SCENARIOS=basic \
ORDER_OUTPUT_DIR=/absolute/evidence/new-capture \
ORDER_SERVER_DIR=/absolute/isolated-server \
ORDER_PYTHON=/absolute/venv/bin/python \
JULIA_MODEL=/absolute/Julia-1 PYTHONPATH=/absolute/Julia-1 \
MBOT_DETERMINISTIC_PREPARATION=1 TEST_REVISION=$(git rev-parse HEAD) \
node docs/evidence/deterministic-preparation-drop-recovery-1201/run.js
```

Seleções: basic; blocked,ambiguous,wrong,outside,mixed,table;
abrupt_dig,abrupt_pickup,server_crash. Reconnect e restart são passos manuais do
harness; nenhuma flag de dispatch/resume automático foi introduzida.
