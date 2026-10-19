# Terreno natural, noite, morte, perda de espada e monitor de staging — Minecraft 1.20.1

HEAD inicial do ciclo `f9f24de`; commits do ciclo até `1c86de9` (CI e StateMachine-spike verdes em todos
eles, exceto o `48cc9b1` do ciclo anterior, corrigido). Servidor vanilla 1.20.1 descartável; Julia desligada
(`executionAuthority = none`); `scripts/` tem os harnesses/instrumentação (só leitura) e
`failed-and-superseded/` guarda as rodadas ruins/anteriores às correções. Evidência do monitor de ameaça no
staging: `../staging-threat-monitor-1201/`.

## 1. Monitor de ameaça no staging — COMPROVADO
`staging.start` → `goTo` → zombie → `cancel` → `defend.start` (taskVersion 9 → 10 de forma síncrona) →
`staging.end ok:false` → tarefa `CANCELLED`, nenhuma ação física do owner antigo; defesa real; o planner
re-despachou sozinho e o fluxo completou. Controle sem ameaça: staging normal.

## 2. Noite — COMPROVADO (correção pequena)
Antes: explorador desarmado à noite só devolvia `PLAYER_LOOP_PREEMPTED` (a política escolhe `return_base`,
que o loop de `explorar` não executava) e ficava parado fora da base. Agora executa o `returnHome` existente
(1× sob o mesmo owner): a (345,−330) voltou à base em ~5 s; ficou em `sleep_or_shelter` (PREEMPTED a cada
~10 s, sem escalar backoff) e retomou a exploração ao amanhecer. Cama/abrigo **não** implementados.

## 3. Perda de espada — COMPROVADO
Com o modo automático ligado, `clear` da espada + recursos recolocados: re-preparação do zero (novo craft, nova
espada, sem memória). Uma rodada atrasada pelo sync de estoque que desloca o explorador (harness).

## 4. Morte — COMPROVADO (com artefato de harness)
`kill` no meio do gather: tarefa antiga `CANCELLED` (`Digging aborted`), sem ações depois; respawn a ~340 blocos
da base com inventário vazio; o planner lê o estado real. Bug: `explorar` calcula alvos relativos à base e o
explorador passou 30 s tentando um caminho enorme → agora, além de `raio+32` do centro, volta primeiro com o
`returnHome`: caminhou ~340 blocos em ~135 s (o fim falhou só porque a base de teste é a plataforma em y=200).

## 5. Terreno natural — achados e correções (medidos)
Camp natural: base na borda de uma floresta (carvalhos do `/place feature`), afloramento natural de pedra a
~3 blocos, mesa de base entre os dois. **Medição inicial: 0/6** posições iniciais prepararam (mesa↔árvore 6,3–9,2
blocos, mesa↔pedra ≥4,5): mesa + madeira + pedra nunca cabem numa janela de 4 blocos.
Evolução pequena e **opt-in**: `MBOT_PREPARATION_RADIUS` (padrão 4 = idêntico; máx. 8) com **uma** caminhada
guardada até a fonte distante. Bugs reais que o terreno natural revelou, um por vez:
| # | Achado | Causa | Correção |
|---|---|---|---|
| a | allowlist vazia de árvores | `findBlocks` por proximidade: pedras enterradas / afloramento esgotam a cota de 32 | duas varreduras limitadas (tronco/pedra), só expostos, sem queda acima, 16 por recurso |
| b | `TARGET_BLOCKED` em pedras utilizáveis | `mineBlocks` filtrava `findBlocks(64)` pela lista aprovada → quase nada sobrava | com lista aprovada os candidatos SÃO a lista |
| c | pedras visíveis recusadas | mira só no centro raspa em vizinhos (ângulo raso) | mira também na face superior e nas faces laterais com ar |
| d | tronco-base recusado | copa baixa de carvalhos de 4 blocos oculta a visada | ir à célula de pé com raio olhos→tronco livre; cavar até 3 folhas na linha de visada (opt-in) |
| e | folha cavada mas ainda recusado | `dig` resolve antes da atualização do mundo; o laço não marcava visível quando o raio já acertava o alvo | espera de 4 ticks e `visível` se o `hit` já é o alvo |
| f | `TIMEOUT` pós-caminhada | 8 s de caminhada antes do 1º `mineBlocks` consumiam o orçamento de 20 s | +8 s só no modo raio>4 (dados: 2/8 rodadas) |
| g | 28 % do tempo em tarefas `explorar` rejeitadas (30 s de pathfinder) | alvos em anel com y fixo caem no ar sobre o oceano/rocha | alvo ciente do solo: superfície real, descarta água/lava/sem chão |
| h | recusa física do executor virava falha com backoff até 58 s | `TARGET_BLOCKED` etc. tratados como erro | degrada para exploração clássica (`preparationSkipped afterStep`) |
**Soak por planner (8 rodadas, raio 8, zombie nas rodadas pares)**: 3/8 → 5/8 → 5/8 → 6/8; configuração final:
6/8 armadas, as 3 rodadas com zombie recuperadas, 7 espadas para 7 preparações, 0 `TIMEOUT`, backoff máx. 14 s,
5 % do tempo em tarefas rejeitadas (28 % antes). Resíduos: drop de tronco parado a 1,7 do bot (1/8) e árvores cujas
4 células vizinhas têm folhas à altura da cabeça sem alcance para cortar.

## 6. Limites / não testado
Julia shadow não rodada neste ciclo; StateMachine real bloqueada (plugin ausente; só o spike do CI); dois
exploradores em terreno natural, `mine_iron` e noite com explorador armado não testados; mundo de teste sem
florestas nativas (árvores via `/place feature`, copa e formato aleatórios por reset); distância de vários
chunks e cavernas não exercitadas.
