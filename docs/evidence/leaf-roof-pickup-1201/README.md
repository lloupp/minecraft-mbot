# Folhas de teto no pickup do tronco (raio 8, opt-in `clearLeaves`) — Minecraft 1.20.1

HEAD inicial `cff4c33`. Mudança: `lib/gather.js` — com `clearLeaves` (só `MBOT_PREPARATION_RADIUS>4`), se o drop
esperado ficou no chão após a 1ª passada, cava até 3 folhas de **teto** (y+1) nas células da linha bot→item
(só `_leaves`, `canDigBlock`, cada dig anunciado em `beforeAction`), depois a 2ª passada de `retryPickup`.
Sem a opção: caminho clássico idêntico. Teste novo (vermelho sem a correção, verde com): 557/557.

## Medição isolada (`scripts/nook6.js`, `nook3.js`; Movements real do worker, `canDig=false`) — COMPROVADO
| variante | pickup |
|---|---|
| sem túnel (`nook6 S=0`) | 10/14 |
| protótipo de túnel (`nook6 S=1`) | 13/14 |
| código real, `mineBlocks` com `clearLeaves` (`nook3`) | **14/14** (antes: 8/12 e 10/12) |
Hipótese anterior (cavar só a folha sobre a célula do drop) já tinha sido refutada; o gargalo era o **caminho de
entrada** coberto, não o teto do item.

## Soak do planner (`results/`, mesmo harness do ciclo anterior) — INCONCLUSIVO
B 4/6 (antes 3/6), C2 5/6 (5/6), A×2 6/12 (7/12): **15/24 vs 15/24**. As falhas restantes não são pickup:
`caminho demorou demais` em pernas de exploração (4×, perde ~25 s da janela de 40 s), `TIMEOUT` do passo (28 s),
rodadas de zombie truncadas pela janela, `APPROVED_TARGETS_INSUFFICIENT` com dois exploradores após a ameaça.
N pequeno: a melhora do soak não é distinguível do ruído; a do pickup isolado é.

## Classificação
COMPROVADO: pickup em bolsão de folhas 10/14→14/14; opt-in preservado. NÃO TESTADO: floresta real, outros biomas.
BLOQUEADO: StateMachine real, Julia shadow. Próximo gargalo: timeouts de pathfinder nas pernas de exploração e
orçamento (28 s) do passo de preparação, ambos medidos neste soak.
