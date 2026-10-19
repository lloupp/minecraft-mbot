# Safety e identidade do drop durante recovery — Minecraft Java 1.20.1

Referência: `1250b9bea5e42f4d0312f8150c4dc918d7a4aba0`, branch
`experiment/julia-laya-andy-player-loop-v2`, PR #78. CI #285 e StateMachine #94
verdes nessa referência. Mundo isolado `recovery-safety-world`, servidor oficial
Java 1.20.1, Java17, Mineflayer e WorkerController reais. Julia oficial em CPU,
snapshot `a85b127321d580d65176c89ced8273f305745d85`, somente shadow.
Preparação opt-in apenas no harness; tarefas e retomadas submetidas manualmente.
Nenhum dispatch/resume/reconnect automático, mudança de main, merge ou benchmark.

## Hipótese e risco escolhido

As evidências anteriores comprovavam recovery após reconnect, mas deixavam abertas
as janelas durante o próprio movimento. O HEAD atual fixa a entidade selecionada e
revalida antes de goto. Isso poderia ainda permitir que um goal já em voo
sobrevivesse ao desaparecimento daquela entidade, atribuindo a ela outro pickup.
Validamos essa hipótese junto com safety e substituição de ownership.

Cada cenário começa com stick1, stone_pickaxe1 e duas pedras autorizadas em
(0,200,2) e (2,200,0). O primeiro dig real produz air e uma entidade cobblestone;
a sessão é encerrada antes de pickup confirmado. Nova instância Mineflayer/Worker
lê inventário0, primeiro alvo air, drop real presente e segunda pedra existente.
O bot é posicionado em (.5,200,-1.5) para abrir uma janela de movimento observável.
A preparação entra por WorkerController.run com objective explorar e a allowlist
original explícita. Intervenções começam depois da submissão real de goto.

## Resultado real

| Cenário | Baseline | Reteste com correção |
|---|---|---|
| Zombie com AI a 6 blocos durante recovery | THREAT; nenhum novo passo após safety. Pickup já em andamento confirmou1; plano restante1. Retomada manual coletou somente segunda pedra, craft/equip → continue_objective. | THREAT; pickup ainda não confirmado, delta0/plano2. Depois de remover ameaça e reavaliar: recuperou drop original1, coletou segunda pedra1, craft/equip → continue_objective. |
| Nova tarefa ir_local durante recovery | CANCELLED, delta0. Owner antigo encerrou antes da nova tarefa física. Retomada manual recuperou1 e coletou somente1, espada equipada. | Mesmo resultado; inventário real, pickupObserved=true no recovery válido da retomada, espada única e continue_objective. |
| Drop selecionado removido e outro cobblestone colocado no mesmo ponto | **Falha preservada:** goto continuou, replacement entrou no inventário e delta1 foi atribuído ao selectedDropId antigo; executor ainda coletou segunda pedra. | RECOVERY_DROP_CHANGED; goto encerrado, delta0, inventoryConfirmed=false, pickupObserved=false, remainingPlan2; nenhuma coleta/craft/equip subsequente. Replacement permaneceu no mundo, sem tentativa de recuperação por essa tarefa. |

O terceiro controle usa kill/summon de entidades reais pelo console para reproduzir
a troca; não injeta cobblestone no inventário. Nos outros cenários, recovery usa
somente o drop do dig real. O zombie tem AI ativa, sem NoAI; este teste comprova
interrupção de pickup, não ataque ou eficácia de combate. A remoção da ameaça é
manual. O material creditado vem dos pacotes de inventário, nunca do dig ou apenas
do evento de coleta. As diferenças delta0/delta1 entre as duas execuções de ameaça
são resultado real de timing, preservado sem pressupor rollback.

## Causa e correção pequena

Fixar matches(entity) evita selecionar outro item na próxima iteração, mas não
interrompe o goto já submetido para as mesmas coordenadas. O helper de recovery
agora observa entityGone da entidade selecionada enquanto a coleta está ativa e
cancela aquele goal. Retorna RECOVERY_DROP_CHANGED antes de avançar o plano.
playerCollect pelo próprio bot distingue o pickup normal da remoção sem coleta.
Mesmo nesse caso, pickupObserved é somente diagnóstico: delta e
inventoryConfirmed continuam derivados do inventário real.

Listeners são removidos no finally, que também preserva progresso real e motivo
de interrupção. Não mudamos raio2, allowlist, executor de recursos, recipes,
ownership, prompts ou autoridade. Testes novos cobrem remoção durante movimento,
limpeza de listeners e pickup observado com/sem confirmação de inventário.

## Evidência e validação

- `baseline/`: falha original e controles no HEAD de referência, 276 eventos.
- `verification/`: três retestes com a correção, 271 eventos.
- Ambos recorders contínuos; appendMissing=[] e bufferMissing=[]. O buffer guarda
  cada evento serializado no instante da observação, sem reconstrução posterior.
- `summary.py` / `summary.json`: **70/70** auditorias das capturas gravadas.
- `npm run check`: aprovado.
- Forced preparation/worker/player-loop: **49/49**; somente preparation/worker
  durante desenvolvimento: **36/36**.
- `npm test`: **474/474**.
- Python Julia sidecar: **2/2**.
- Quatro inferências reais shadow, zero erros do sidecar; latências de parede
  98–149 ms. Escolhas e saídas brutas registradas, nunca usadas para execução.

Todos os digs observados pertencem à allowlist; nenhuma segunda quebra do alvo
que já virou air. Nenhum novo dig/craft/equip/place/goto entre safety detectado e
retorno da tarefa interrompida. Nenhuma sobreposição dos dig/craft/equip/place
instrumentados. Sessões antigas encerraram DISCONNECTED, sem nova ação após quit.
Capturas contêm timeline, taskVersion, inventários, entity IDs, posições, health,
candidatos, remainingPlan, source-sha256 e cópia exata do harness usado.

O servidor offline registrou falha de consulta ao serviço de autenticação
(api.minecraftservices.com) no startup; as sessões locais e os testes físicos
funcionaram. Esse log está preservado. Não é erro de recovery nem prova de acesso
a um servidor autenticado. Servidor/sidecar foram encerrados ao fim.

## Limites e próximo problema

Não prometemos abortar atomicamente um pickup já em andamento: o caso baseline de
ameaça recebeu1 após a parada, e o inventário foi preservado corretamente. Cancelar
o goal também não impede pickup automático incidental de um item já em contato.
Se houver delta real junto de uma recusa, ele deve continuar sendo registrado e a
próxima tentativa deve replanejar pelo inventário, sem fingir rollback.

Um único cobblestone próximo ao alvo autorizado não prova proveniência histórica
cross-session. Não criamos persistência/correlação. Este ciclo testa remoção/troca
de entidade; não comprova toda mutação possível de stack, deslocamento ou entrada
de uma segunda entidade durante o movimento. Craft já submetido continua não
atomicamente cancelável. Não reexecutamos os cenários anteriores de crash/ataque.

O próximo passo mais relevante é validar a viabilidade física na política limitada
(mesa, ferramenta, alvo acessível) e um avanço opt-in do objetivo com número limitado
de tentativas/recusas. A integração ainda não foi ativada: recusar com segurança
não basta para garantir que o objetivo continue sem intervenção. Julia segue sem
qualquer autoridade.

Reprodução curta: use as variáveis ORDER_OUTPUT_DIR, ORDER_SERVER_DIR,
ORDER_PYTHON, JULIA_MODEL/PYTHONPATH e MBOT_DETERMINISTIC_PREPARATION=1 descritas
na evidência anterior; execute `node .../run.js` com
`SCENARIOS=threat,new_order,replacement`. Use mundo isolado: o harness limpa a
plataforma e inventário dos bots de teste. Para auditar, execute
`python docs/evidence/deterministic-recovery-safety-1201/summary.py`.
