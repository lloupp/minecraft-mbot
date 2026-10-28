# StateMachine, AutoEat, Movement e Panorama — testes isolados

**Minecraft Java 1.20.1 · Node.js 22 · Java 21 · 28/10/2026**

PR: https://github.com/lloupp/minecraft-mbot/pull/93

Execução funcional do primeiro ciclo: https://github.com/lloupp/minecraft-mbot/actions/runs/40629022200

## Regras de execução

Cada plugin recebe um job separado, novo processo Node, mundo flat descartável, servidor oficial vanilla 1.20.1 validado pelo SHA-1 já fixado no projeto e endereço **127.0.0.1**, nunca o servidor existente do usuário. O job instala o candidato no runner com `--no-save --package-lock=false`. O `package.json`, `package-lock.json`, `index.js`, o bot principal, o servidor remoto e a `main` não mudaram.

## Resultados observados

| Plugin / upstream | Resultado | Prova física ou bloqueio | Limites |
|---|---|---|---|
| [mineflayer-statemachine@1.7.0](https://github.com/PrismarineJS/mineflayer-statemachine) | **PASS** | adaptador já existente `lib/stateMachineExplore.js` fez movimento real até (5.5,63,0.5), destino (6,63,0); transição `cancelled` também passou | não prova cancelamento de movimento já iniciado, múltiplos workers, ou preempção de survival |
| [mineflayer-auto-eat@5.0.3](https://github.com/linkle69/mineflayer-auto-eat) | **PASS** | fome provocada por efeito no jogo; comeu `cooked_beef`, estoque 8→7, evento `eatFinish` e `disableAuto()` confirmado | ESM; não ativar simultaneamente com `lib/food.js`/crafting sem ownership exclusivo e drain seguro |
| [mineflayer-movement@0.4.2](https://github.com/firejoust/mineflayer-movement) | **PASS** | controle reativo moveu 2.318 blocos em 13 physicsTicks; comando `forward` liberado no fim | não comprova desvio de obstáculos, fuga, trajetos longos nem convivência com `pathfinder` controlando o mesmo bot |
| [mineflayer-panorama@0.0.1](https://github.com/IceTank/mineflayer-panorama) | **BLOCKED / XFAIL de instalação** | falha real `gl` → `node-gyp@7.1.2` no Node 22: `Cannot assign to read only property 'cflags'`; nenhuma imagem gerada | não tem evidência de compatibilidade/renderização; requer isolamento em runtime de renderização compatível sem alterar servidor principal |

Os três PASS são **somente diagnósticos de um recurso por vez**. Não equivalem à validação integrada da colônia e não autorizam merge.

## Próximos gates técnicos antes da adoção

1. **StateMachine:** repetir no worker completo com coleta, cancelamento físico com espera da ação anterior terminar, ameaça e retomada; preservar fallback determinístico e `MBOT_STATEMACHINE=0`.
2. **AutoEat:** testar disputa de slot ao craftar, trocar arma e abrir baú; desabilitar `lib/food.js` no worker experimental para ter um dono único do inventário durante consumo; restaurar item anterior e cancelar corretamente; habilitar apenas sob flag de um worker.
3. **Movement:** comparar com Pathfinder em obstáculos reais, degraus, buracos, lava e inimigos; apenas steering de curta distância com ownership de movimento, e rollback quando travar.
4. **Panorama:** isolar renderer em processo/container compatível sem sobrescrever `prismarine-viewer` existente, atualizar bindings nativos no laboratório ou avaliar uma captura a partir do viewer atual; produzir JPEG verificado antes de adotar.
5. Para cada um: CI da branch, smoke real com `index.js` + workers, restart, cancelamento, performance/memória e efeito sobre survival, sempre em mundo descartável.

## Como reproduzir

```bash
npm ci
# Instalar individualmente (só no ambiente de teste, não na produção)
npm install --no-save --package-lock=false --ignore-scripts mineflayer-statemachine@1.7.0
# Apenas para este candidato:
MBOT_TEST_SERVER_JAR=/caminho/vanilla-1.20.1.jar MBOT_TEST_EULA_ACCEPTED=1 node scripts/plugin-requested-smoke.js statemachine
```

Para os demais, substituir a versão e nome pelo item desejado; `autoeat` usa `mineflayer-auto-eat@5.0.3`, `movement` usa `mineflayer-movement@0.4.2`; para panorama a instalação nativa não deve usar `--ignore-scripts` se a intenção for efetivamente testar renderização.

O relatório JSON e logs de servidor de cada job estão nos artifacts do GitHub Actions; não fazemos upload de mundo/JAR ou imagens.

**Nenhum desses quatro foi integrado ao runtime padrão.**
