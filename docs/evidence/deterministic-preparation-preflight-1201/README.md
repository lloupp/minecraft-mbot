# Preflight físico de preparação — Minecraft Java 1.20.1

Referência: `8b4618a334e8d3d076505b672d1af9fe8b9b8634`, branch
`experiment/julia-laya-andy-player-loop-v2`, PR #78. CI #288 e StateMachine #97
verdes na referência. Servidor oficial Java 1.20.1, Java17, mundo isolado
`preflight-world`, Mineflayer/WorkerController reais. Julia oficial CPU, snapshot
`a85b127321d580d65176c89ced8273f305745d85`, somente shadow, autoridade none.
MBOT_DETERMINISTIC_PREPARATION=1 apenas no harness. Nenhuma integração/retomada
ou reconnect automático ativado; main intacta, sem merge, novos plugins,
persistência ou benchmark longo.

## Problema escolhido

Antes de integrar ao objetivo normal, validamos o novo preflight no servidor.
Ele aceitava pedra exposta ao ar mas sem linha de visão e pedra sustentando gravel.
O executor recusava ambos. Corrigimos esses falsos positivos: propor trabalho
inadequado pode causar falhas repetidas numa futura automação.

Estado inicial: explorar desarmado, food/health20, stick1 e stone_pickaxe1,
mesa (-1,200,-1), pedras autorizadas (0,200,2) e (2,200,0). Nenhum cobblestone foi
injetado no inventário. Cada controle reconstrói o fixture no mundo isolado.
Snapshot real refinado somente pela allowlist. A factory apenas propõe;
propostas são enviadas manualmente por WorkerController.run.

## Resultado real

| Caso | Referência | Reteste |
|---|---|---|
| Mesa/ferramenta/duas pedras utilizáveis | Proposta gather; coleta2 confirmada; snapshot novo; proposta prepare_combat; craft/equip; continue_objective | Mesma rota física, espada única equipada, sem segunda coleta |
| Mesa ausente ou distante (8,200,8) | NEARBY_TABLE_REQUIRED, task=null | Lógica não alterada |
| Sem picareta | MINING_PICKAXE_REQUIRED, task=null | Lógica não alterada |
| Allowlist com uma pedra | APPROVED_TARGETS_INSUFFICIENT, task=null | Lógica não alterada |
| Pedras atrás de bedrock | **Falso positivo:** canDig/exposed=true, canSee=false; proposta; executor TARGET_BLOCKED, inventário0 | APPROVED_TARGETS_INSUFFICIENT, task=null, sem execução |
| Gravel acima das pedras | **Falso positivo:** canDig/exposed/fallingAbove=true; proposta; executor GATHER_ITEM_NOT_CONFIRMED, inventário0 | APPROVED_TARGETS_INSUFFICIENT, task=null, sem execução |
| Zombie com AI próximo | task=null; ameaça precede preparação | Executor também recusou ameaça após preflight |
| Cancelamento | task=null no snapshot real com flag controlada | Lógica não alterada |
| Única pickaxe com silk_touch | — | MINING_PICKAXE_REQUIRED, task=null |
| Fome crítica, pig próximo, sem alimento | — | food5, nearby.food=true/distância3; find_food, task=null |

Bedrock em (0,201,1) e (1,201,0) fica fora da allowlist e não foi quebrado.
Gravel fica em y201 sobre as pedras. Não abrimos caminho cavando.
A visibilidade vem do raycast Mineflayer, sem girar/mover o bot no preflight.
Cancelamento é controle de snapshot, não nova prova física de troca de ownership.
Zombie tem AI ativa; não avaliamos combate/ataque neste ciclo.

## TOCTOU: proposta aprovada, estado alterado, execução recusada

Preservamos exatamente a proposta aprovada. O console altera o mundo/inventário,
e somente então essa tarefa entra pelo worker com objective/allowlist originais.

| Mutação | Código do executor | Ações após mutação |
|---|---|---|
| Mesa removida | NEARBY_TABLE_REQUIRED | 0 dig/craft/equip/place/goto |
| Pickaxe removida | MINING_PICKAXE_REQUIRED | 0; inventário real sem ferramenta |
| Primeiro alvo stone vira dirt | APPROVED_TARGETS_INSUFFICIENT | 0; nenhuma coleta de dirt |
| Zombie com AI aparece | THREAT | 0; safety tem precedência |

Inventário cobblestone continua0 em todas as recusas. Isso comprova revalidação
desses casos, não sucesso garantido pelo preflight. Não repetimos drop recovery,
defense handoff, ataques ou crash já cobertos anteriormente.

## Correção e validação

O filtro liveTargets agora exige canDigBlock e canSeeBlock e exclui fontes com
bloco de queda acima via gather.hasFallingAbove. Funções de percepção ausentes
produzem recusa conservadora. Exposição/distância continuam necessárias.
Reutilizamos APIs existentes; não alteramos executor, gather, receitas, quantidade,
raios, allowlist, flag, prompt/modelo ou autoridade. Regressão cobre obstáculo,
gravel e capacidades ausentes; fixtures anteriores fornecem visibilidade explícita.

- Check aprovado; focados preparation/worker/player-loop **53/53**.
- `npm test`: **478/478**; Python Julia sidecar **2/2**.
- `summary.py` / `summary.json`: **77/77** auditorias das capturas reais.
- Duas inferências Julia reais nos momentos multi-candidato de preparação,
  latências302/244ms, 0 erros; payloads/saídas brutas gravados, nunca executados.

Capturas incluem timeline, taskVersion, estados, propostas, inventários,
diagnósticos, resultados, source-sha256 e harness-source exato. Logs/exit codes de
testes estão na raiz. Zero dig fora da allowlist, sobreposição dos dig/craft/equip/
place instrumentados ou progresso inventado nas recusas. Falhas esperadas não
são contadas como sucesso físico.

## Falhas e integridade preservadas

`baseline/` contém os dois falsos positivos e recusas físicas. `verification/`
contém retestes e quatro mutações. Primeiro setup de fome: peaceful e efeito2s,
HARNESS_SETUP_TIMEOUT. `hunger-control/`: normal, mas efeito curto terminou antes
de food cair. `hunger-verification/`: duração10s do harness anterior comprovado,
aguarda food<=5 e remove efeito. Duas falhas de setup preservadas.

Quatro buffers com661 eventos contínuos e bufferMissing=[]; nenhum evento
reconstruído. Append da última captura perdeu seq47/48, causa não estabelecida.
O append original está separado; recorder_integrity registra a diferença.
timeline.jsonl vem do buffer dos eventos serializados no instante da observação,
conforme recorder anterior. Warnings de autenticação externa do servidor offline
preservados; sessões locais funcionaram. Servidor/sidecar encerrados ao fim.

## Automação e próximo gargalo

A factory segue pura; tarefas continuam explícitas. O caso válido exige duas
submissões manuais (gather e prepare), com snapshot/preflight novo entre elas.
continue_objective é candidato final; movimento de explore não foi testado.
Nenhuma nova flag ou integração automática foi conectada.

Próximo: ponte opt-in estreita de explore para passos owned limitados, allowlist
explícita, recusa sem retry infinito e precedência de nova ordem. Será necessário
comprovar gather → reavalia → craft/equip → exploração real, com interrupção.
Preflight não garante estabilidade da mesa/ferramenta/alvos nem acesso após pickup.
Alvos já air com drop pendente não satisfazem o requisito de fontes vivas desse
preflight; recovery segue conservador e explícito. Julia permanece sem autoridade.

Reprodução: ORDER_OUTPUT_DIR, ORDER_SERVER_DIR, ORDER_PYTHON, JULIA_MODEL/PYTHONPATH
e MBOT_DETERMINISTIC_PREPARATION=1 conforme evidência anterior; execute run.js com
SCENARIOS escolhidos. Mundo isolado obrigatório: o harness limpa plataforma e
inventários de teste. Audite com `python .../summary.py`.
