# Navegação com posição confirmada — 2026-09-27

Base origin/main: `7450c9c7ce470fa80d328436c7d179884cc920a2`.
Branch: `fix/verified-worker-navigation`.
Ambiente real: 127.0.0.1:25586, Minecraft Java 1.20.1, Forge 47.4.10, survival normal, dois workers sem OP simultaneamente mais eduardo_bot. Mundo criado no ciclo anterior; sem alterações de terreno, itens fornecidos ou construções destruídas neste ciclo.

## Reprodução

`node deploy/forge-1201/smoke.js` na main atual: lenhador retornou ok=true a **2,1173 m** do centro do destino; minerador a 2,00000047 m. Verificador externo tolera 2,01 m: lenhador FAIL, minerador PASS. O executor antigo não consultava a distância física antes de anunciar sucesso.

## Correção mínima

Somente goToPoint/ir_local: preserva GoalNear raio 2 como primeiro caminho e confirma distância tridimensional ao centro do bloco de destino (x+0,5 / y / z+0,5). Só retorna ok=true com position_confirmed, posição copiada, dimensão, alvo, distância e tolerância 2. Se já estiver dentro, não inicia movimento. Se goto terminar fora, tenta uma única aproximação GoalNear raio 1, mantendo prazo total de 45 segundos. Se ainda estiver fora retorna ok=false / PATH_FAILED. Erros de caminho seguem lançados com código; cancelamento antes/durante navegação retorna cancelled e não inicia aproximação adicional.

Sem plugins novos, mudança da arquitetura, alteração do cancel() ou mudanças nos executores de coleta/estoque/construção. Não generaliza a correção para todos os usos de goTo.

## Resultado no Forge antes da PR

| Cenário | Lenhador | Minerador | Resultado |
| --- | --- | --- | --- |
| Chegada física após correção | 1,000368 m | 1,000000 m | PASS com evidência |
| Cancelamento após 150 ms, observação após 300 ms | cancelado, goal=null; deriva 0,203228 m | cancelado, goal=null; deriva 0,203298 m | FAIL do limite de imobilidade de 0,2 m; novas tarefas chegaram |
| Cancelamento após 150 ms, observação após 2 s de frenagem | cancelado, goal=null, drift=0, controles vazios, ocioso | cancelado, goal=null, drift=0, controles vazios, ocioso | PASS; ambas novas tarefas chegaram a ~1 m |

Na última tentativa o bloco de apoio observado era **ice** nos dois workers. A primeira tentativa de cancelamento permanece preservada; a observação posterior não mede nem promete tempo de frenagem de 2 segundos. As esperas de 300 ms/2 s são janelas fixas do teste, não medições de latência. Não foi aplicada correção de cancelamento: o teste confirmou comando interrompido e retomada por nova tarefa; a deriva inicial é compatível com movimento residual no gelo.

Evidências JSON estão neste diretório; executores e logs completos em `.data/forge-p0/navigation-fix/`. CPU do Node: 13,87% de um core durante o primeiro reteste (4,469 s incluindo espera fixa de 3 s); não aprova performance prolongada.

## Validação e review

Oito regressões novas: sucesso físico após aproximação, goto resolvido sem chegada, idempotência, snapshot independente, cancelamento antes e durante caminho resolvido/rejeitado, distância vertical/entidade ausente, código estável em erro de caminho. npm run check e npm test com Node 22.22.3 via script-shell temporário: **276/276**, zero falhas/skips. git diff --check aprovado.

Review local: checados prazo global, limite de aproximações, cancelamento antes de cada nova ação, evidência só em chegada confirmada e dados simples da evidência. Nenhuma ação antiga toma o pathfinder após cancelamento. Não valida obstáculos/rota longa, combate, crafting, estoque, construção ou checkpoint/restart de objetivo.

Gate final: CI verde, merge da PR e repetição do smoke no Forge com o commit mesclado; registrar resultado final local em `.data/forge-p0/navigation-fix/post-merge.json`.
