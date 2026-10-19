# Defesa → preparação e reconnect — Minecraft Java 1.20.1

Referência: `2ab55e17e6ead074bb1780c84f90dc8f86ba603f`, PR #78, branch
`experiment/julia-laya-andy-player-loop-v2`. Mundo local isolado; sem construções
externas. Julia real, snapshot oficial `a85b127321d580d65176c89ced8273f305745d85`,
CPU, somente shadow. `MBOT_DETERMINISTIC_PREPARATION=1` apenas no harness.
Não houve dispatch/retomada automática, merge, alteração de main ou benchmark.

## Resultado real

| Cenário | Evidência | Resultado |
|---|---|---|
| Handoff inverso e tarefa exata retornada | `final-handoff-table-in-range/` | Primeiro cobblestone confirmado; zombie com AI atingiu o bot (20→17); defesa assumiu taskVersion novo; preparação retornou CANCELLED; defesa terminou; candidato preservou objective/allowlist; execução manual coletou apenas 1; outra etapa manual craftou/equipou stone_sword; `[continue_objective]`. |
| Nova ordem antes do resume | `baseline-real/`, `new_order_invalidates` | Candidato existente → `ir_local` → pending `null`, sem preparação posterior. |
| Ameaça ainda presente no fim da defesa | `verification/`, `threat_precedence` | Segundo zombie real continuou no snapshot; pending `null`, `escape_danger`; após remoção, reavaliação explícita permitiu gather_materials. |
| Fome crítica e comida real próxima | `verification/`, `hunger_precedence` | Food 5, cow próxima, pending `null`, singleton find_food. Após resolver fome houve reavaliação manual; permaneceu `null` porque a pedra estava a 4,51 m, fora do alcance limitado. |
| Estabilidade pós-defesa | `final-handoff-table-in-range/` | Capturas no fim efetivo, +250,04, +500,02 e +999,85 ms: threat, health, food, inventory, heldItem, nearby, candidatos e resume iguais. Não foi necessário acrescentar espera ao código de produção. |

A defesa foi a implementação real de `WorkerController.defend`/`combat.fight`.
O zombie atacante foi resolvido pelo console do servidor para encerrar o cenário;
isto comprova ownership/handoff, não eficácia de combate. As fases de preparo
passaram por `WorkerController.run`, nunca apenas por executePreparationStep.

A timeline registra as duas tentativas de dig na tarefa inicial: a primeira tem
pickup confirmado; a segunda foi abortada pelo ownership de defesa. Na retomada
há uma única coleta adicional. Nenhum bloco fora dos dois alvos autorizados foi
escavado. Entre o fim da defesa e o envio manual do candidato houve **zero**
dig/craft/equip de preparação. O crafting posterior também foi enviado manualmente
após nova avaliação, pois cada tarefa executa somente uma etapa limitada.

## Bugs e recusas preservadas

1. **Resume perdia uma fonte real após deslocamento do combate.** Em
   `baseline-affected/threat_precedence`, pedra autorizada presente a 3,566 m,
   inventário com 1 cobblestone, mas `nearby.stone=false` na amostragem esparsa;
   buildPreparationResumeTask retornava null após remover a ameaça.
   Correção: extrair `preparationStateSnapshot` da leitura já existente no executor
   e reutilizá-la no resume. Ela consulta somente até 64 posições explícitas,
   nomes atuais e distância ≤4 m. Não acrescenta recurso nem alvo.
   Teste cobre fonte perdida pela amostragem, bloco destruído e ameaça.
2. **Fechamento do stream antes do evento end permitia equip antigo.** Em
   `reconnect/reconnect_sword`, seq144 quit, seq147 equip, seq151 end; a tarefa
   reportava sucesso local durante fechamento. Correção: o safety guard recusa
   `ended`, stream `writableEnded` ou socket `destroyed`, com código DISCONNECTED
   latched, antes de nova operação. O ownership também continua sendo invalidado
   no end. Teste cobre craft já produzido e retomada que somente equipa.
   Repetição real: `reconnect-sword-verification/`, seq30 quit, seq33 DISCONNECTED,
   seq35 end; primeiro equip somente na nova sessão, seq41.
3. **Mesa fora de alcance:** `final-handoff/` retornou NEARBY_TABLE_REQUIRED sem
   ação. O combate deslocou o bot para além de 4 m da mesa. Não mudamos o executor;
   repetimos somente o handoff com mesa desde o início em (-1,200,1), que permanece
   acessível. A captura recusada continua incluída.
4. **Fixtures:** `baseline/` contém a primeira falha de ambiente (runtime antigo
   em /tmp ausente, antes do servidor). Servidor/modelo foram restaurados oficialmente.
   A primeira captura de fome em `baseline-real/` perdeu a cow do raio após
   deslocamento; retornou return_base e não conta como prova de find_food.
   Na repetição, resistência temporária depois do primeiro ataque e resistência
   ao knockback do zombie mantiveram comida observável. Nenhum resultado físico
   ou snapshot foi simulado. Todos os zombie de interrupção tinham AI, sem NoAI.

## Reconnect (subseção separada)

Nova instância Mineflayer e novo WorkerController, mesmo nome/identidade offline,
mesmo servidor e playerdata. Não copiamos inventário entre bots. Os snapshots da
nova sessão vieram dos pacotes do servidor; mundo/targets foram lidos novamente.

| Caso | Inventário real após reconnect | Reavaliação e execução |
|---|---|---|
| A: pickup confirmado | 1 cobblestone + stick + stone_pickaxe | Plano collect=1; primeiro alvo virou air; coletou só segundo alvo, craft/equip e continue_objective. |
| B: dig terminou, pickup não confirmado | Zero cobblestone; stick/pickaxe mantidos | Plano collect=2; primeiro alvo era air, só uma pedra válida na allowlist; APPROVED_TARGETS_INSUFFICIENT antes de dig. Drop observável registrado na timeline, sem creditá-lo ao inventário. |
| Espada produzida antes de fechar | 1 stone_sword | Após correção, old task DISCONNECTED; nova tarefa equip_best_weapon, sem gather e sem segundo craft. |

Nos três casos as promises antigas encerraram; taskVersion antigo foi invalidado;
nenhuma nova operação física ocorreu depois do end da sessão antiga. Após a
correção do caso espada, também não houve nova operação depois da solicitação de
quit. A desconexão deliberada não promete abortar atomicamente craft já enviado.

B foi uma **recusa segura**, não uma recuperação completa do drop. Não foi criada
persistência/correlação cross-session nem executor genérico de pickup. Não presumimos
que um dig garante item e não reutilizamos target destruído.

## Validação e limites

`npm run check`; 28 testes focados de forced-preparation/worker; 466 testes totais
(`npm test`); 2 Python sidecar. Logs e exit codes em `tests*.log`/`tests.json`.
`python .../summary.py` audita capturas gravadas: **20/20** checks. Não gera estados
simulados. Zero digs não autorizados, sobreposição física de preparação ou início
automático. Falhas e recusas acima permanecem disponíveis; não alegamos zero
falhas em todas as tentativas exploratórias.

CI e StateMachine do HEAD de referência passaram (runs 36838971627/36838971601).
O status do HEAD publicado é registrado na atualização da PR.

Ainda falta antes de integração normal: tratar explicitamente deslocamento para
fora do alcance de mesa/materiais; recuperação de drop não confirmado com nova
verificação/allowlist; testar queda abrupta de transporte e lifecycle em outros
pontos, sem depender de quit voluntário; definir quando uma reavaliação manual vira
uma transição autorizada no fluxo normal. O candidato é uma proposta lógica, não
uma garantia de mesa/recurso acessível. O executor revalida tudo e pode recusar.
Este ciclo não autoriza Julia nem liga retomada automática.

## Reprodução curta

`run.js` inicia servidor oficial, sidecar real e bots no mesmo processo pai.
Cada pasta contém `harness-source.txt` da versão exata usada, SHA256 dos arquivos
produtivos, timeline, resultados, logs e metadados. Código Python do recorder está
em `capture_sidecar.py`. Preparar Java17, server.jar/EULA 1.20.1 e o snapshot Julia
com dependências registradas em runtime-environment.json. Por exemplo:

```bash
SCENARIOS=handoff \
ORDER_OUTPUT_DIR=/absolute/evidence/new-capture \
ORDER_SERVER_DIR=/absolute/isolated-server \
ORDER_PYTHON=/absolute/venv/bin/python \
JULIA_MODEL=/absolute/Julia-1 PYTHONPATH=/absolute/Julia-1 \
MBOT_DETERMINISTIC_PREPARATION=1 TEST_REVISION=$(git rev-parse HEAD) \
node docs/evidence/deterministic-preparation-defense-handoff-1201/run.js
```

Outras seleções: `new_order`, `threat,hunger`, `reconnect`; este último aceita
`RECONNECT_MODES=confirmed,unconfirmed,sword` ou somente `sword`. Não executar sobre
mundo com construções: fixtures limpam plataforma e inventário dos bots de teste.
