# Gate de chegada física — cinco rodadas em Forge

Base: main `94fa960f20b29bcf4df4eadaa65e18c8f9515f3b` (PR #61 já mesclada). Branch `fix/navigation-final-position-verification`. Não reaplica nem substitui a correção existente.

## Causa e estado inicial

A falha original foi reproduzida no servidor real antes da PR #61: GoalNear finalizava por coordenadas discretas, mas goToPoint retornava ok=true sem medir a posição dos pés. O lenhador terminou a 2,1173 m do centro do destino no reteste da main antiga. A reprodução, falhas anteriores e correção estão em `docs/evidence/navigation-fix/` e `docs/evidence/forge-1201/`; não se atribui essa falha à main atual, onde a PR #61 já introduziu verificação física e reaproximação limitada.

Nesta PR o sucesso explicita verified=true e distance, preservando evidence.position_confirmed. Fora do raio, o resultado retorna verified=false, distância física (null se indisponível) e failure.code=NAVIGATION_POSITION_NOT_CONFIRMED; falha de pathfinder continua PATH_FAILED. A distinção ajuda o chamador a identificar que o caminho terminou sem confirmar chegada.

O ponto físico continua definido uma única vez em goToPoint: floor(x)+0,5, floor(y), floor(z)+0,5. A posição Mineflayer corresponde aos pés; distância é tridimensional, incluindo Y. O executor exige <=2 m, mais estrito que os 2,01 m do smoke. Primeiro GoalNear raio 2, depois no máximo uma aproximação raio 1, prazo total 45 s. Não se altera a tolerância, o smoke, pathfinder compartilhado, cancel(), plugins ou demais executores.

## Regressões e review

A suíte existente já cobre sucesso físico, goto resolvido fora do raio, aproximação que chega, aproximação que permanece fora, cancelamento e idempotência. Esta PR fortalece os asserts de distância/verified/código e acrescenta duas regressões:

- Cancelamento durante a segunda aproximação não pode confirmar sucesso, mesmo se a posição chegar ao destino nesse instante.
- Dois workers em aproximação simultânea mantêm objetivos/resultados separados; cancelar um não altera o sucesso do outro.

`npm run check` aprovado; `npm test`: 281 testes, 281 aprovados, zero falhas/skips, Node 22.22.3, 22,433 s. Script-shell temporário prioriza Node 22 porque há Node 19 preexistente em node_modules. `git diff --check` aprovado. Review local conferiu compatibilidade com chamadores, dados serializáveis, código de falha específico, ausência de estado global novo e limite de tentativas/prazo. Não são novos checkpoints.

## Teste real

Cinco execuções **sem alteração** de `node deploy/forge-1201/smoke.js`, após a suíte local verde, no commit de runtime `793292c` (hash completo em results.json). EduardoBot + lenhador_01 + minerador_01, dois workers simultâneos por rodada, survival, sem OP, Forge 47.4.10 / Minecraft Java 1.20.1, 127.0.0.1:25586. Nenhum recurso, construção ou terreno foi criado/alterado para as rodadas. São viagens curtas em terreno natural existente, incluindo gelo, sem promessa de cobrir toda irregularidade possível.

| Rodada | Lenhador distância (m) | Minerador distância (m) | Lenhador tempo (s) | Minerador tempo (s) | CPU Node (% de um core) | Resultado |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1,000000165 | 1,000000105 | 1,317 | 1,341 | 13,90 | PASS |
| 2 | 1,000000088 | 1,000000105 | 1,363 | 1,383 | 17,98 | PASS |
| 3 | 1,000000088 | 1,000000000 | 1,533 | 1,559 | 13,65 | PASS |
| 4 | 1,000000088 | 1,000000000 | 1,529 | 1,560 | 14,74 | PASS |
| 5 | 1,000000088 | 1,000000000 | 1,416 | 1,394 | 13,55 | PASS |

Todas as 10 tarefas: WorkerController ok=true, verified=true, evidence.position_confirmed, distância <=2; smoke verified=true, report.ok=true, exit=0, vida=20 e fome=20. **5 sucessos, 0 falhas; motivos de falha: nenhum**. Nenhum worker preso ou conflito de pathfinder observado nessas execuções; não houve injeção de falha nem cenário adversarial de stuck. CPU inclui navegação + espera fixa de 3 s, não é medição pura de pathfinding nem CPU do servidor. Não aprova desempenho prolongado.

`results.json` registra cada posição inicial, destino, posição final, distância, tempo, resultado completo, saúde/fome, erros, CPU e hashes das evidências brutas. JSON/logs completos em `.data/forge-p0/navigation-five/`. Smokes anteriores reprovados continuam nos diretórios históricos, sem exclusão.

## Gates

Gate de chegada física apto a avançar após CI verde/merge desta PR. P0 completo **não aprovado**. Próximo gate: containers/estoque com dois workers, em ciclo separado, sem incluir nova logística nesta PR. Depois coleta com inventário confirmado, crafting, furnace, recurso inacessível/alternativa, cancelamento, stuck, restart, checkpoints e desempenho prolongado, nessa ordem.
