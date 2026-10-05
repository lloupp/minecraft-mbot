# Pernas de exploração presas: servidor rejeitando o movimento a cada tick — Minecraft 1.20.1

HEAD inicial `74235f6`. Mudança: `core/WorkerController.js` `goTo` — além do timeout, ouve `forcedMove`; 40 correções
de posição seguidas (≤500 ms entre elas) sem o bot sair de 0,5 bloco do ponto → `setGoal(null)` e erro
`servidor rejeitou o movimento`. Teleporte isolado ou correções com progresso não disparam (teste). Dois testes
novos (o primeiro vermelho sem a correção); `npm run check` ok, `npm test` 559/559.

## Instrumentação antes de mexer (`scripts/xp-cycle8-instrumentation.js`, `legs.py`) — COMPROVADO
Soak A (antes, `before/`): 5 pernas de exploração falharam com `caminho demorou demais`, **150 s perdidos**. Alvos
carregados, `surfaceAt` ok, pathfinder com `success` em poucos ms — e o bot parado no mesmo ponto 30 s.
Reprodução isolada (`scripts/leg*.js`, `Movements` do worker): 6/6 pernas congelam em x≈−2,3.
* `leg3_freeze.out`: 587 pacotes `position` do servidor em 600 ticks; velocidade 0, `onGround=false`, sem controles.
* `leg4_packets.out`: no tick 56 o cliente envia x=−2,208 z=−211,106 — a caixa do jogador (x −2,508…−1,908) entra no
  bloco de grama em (−2,74,−212), um degrau de 1 bloco subido **na diagonal**. O servidor devolve a posição; o
  pathfinder repete o mesmo passo a cada tick. O bloco existe igual no cliente e no servidor (`execute if block`):
  não é bloco fantasma, é a colisão da física do cliente (prismarine-physics) no degrau diagonal.
* Uma das duas posições fica rente à parede vertical que o `fill` de reset do harness corta no terreno (z=−196);
  a outra é uma encosta natural de degraus de 1 bloco. As duas reproduzem igual.
* `leg5_*.out`: detecção em ~2,1 s (vs 30 s). Replanejar após a detecção **não** escapa (3/3 rejeitadas de novo) →
  a correção só desiste cedo; a exploração escolhe outra direção na tarefa seguinte. Não alterei `node_modules`.

## Depois (`results/`) — COMPROVADO
| soak | pernas presas | tempo perdido | armados |
|---|---|---|---|
| A antes (`explorador_02` residual presente) | 5 | 150 s | 01: 5/6 |
| A depois | 2 | **18 s** (7,6 s e 10,4 s, incluindo a caminhada) | 01: 5/6* |
| B antes (idem) | 0 | 0 | 01: 5/6 |
| B depois | 0 | 0 | 01: 5/6 |
\* a rodada 5 aparece "no" no resumo, mas os dois passos de preparação deram ok (espada feita); a perna de
exploração seguinte foi rejeitada e o `run.reject` não carrega os passos — artefato do resumo.
A rejeição continua sendo falha real para o orquestrador (backoff), como o timeout era.

## Classificação
COMPROVADO: causa-raiz das pernas presas (degrau diagonal + correção do servidor a cada tick); 150 s → 18 s.
NÃO RESOLVIDO: atravessar esse degrau (exigiria contornar a física do cliente ou outra rota). NÃO TESTADO: outros
terrenos/biomas. BLOQUEADO: StateMachine real, Julia shadow. O `TIMEOUT` de 28 s do passo de preparação não
apareceu nesses soaks (passo de coleta mais longo: 21,6 s).
