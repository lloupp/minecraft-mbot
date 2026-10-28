# Plugins candidatos — diagnóstico real Minecraft Java 1.20.1 (28/10/2026)

Referência: [PR #93](https://github.com/lloupp/minecraft-mbot/pull/93). Execução verificada: [GitHub Actions #40627230275](https://github.com/lloupp/minecraft-mbot/actions/runs/40627230275).

## Protocolo

- Uma execução independente de GitHub Actions para cada candidato, com `fail-fast: false`.
- Cada job executa `npm ci` e instala temporariamente **apenas no runner** os candidatos versionados `mineflayer-tps@1.0.1`, `mineflayer-death-event@2.0.0`, `mineflayer-bloodhound@0.0.2`, com `--no-save --package-lock=false`. Nenhuma dependência nova entra em `package.json` ou no lockfile.
- Servidor oficial Minecraft Java 1.20.1 baixado e SHA-1 validado; mundo temporário em 127.0.0.1; EULA explícita apenas no CI; Java 21 e Node 22.
- Cada candidato foi carregado **isoladamente**. Logs JSON e log do servidor nos artifacts do workflow, sem uploads de JAR/mundo.
- **Não** foi usado o servidor doméstico, Forge, outros mods nem o player loop integral.

## Resultados verificados

| Plugin | Resultado funcional | Gate de integração |
|---|---|---|
| [mineflayer-tps@1.0.1](https://www.npmjs.com/package/mineflayer-tps) | **PASS diagnóstico**: `getTps()` retornou inteiro 2 (dentro de 0..20), worldAge avançou 57 ticks na amostra de 3,3s; sem erros | **BLOQUEADO** para runtime: ainda sem prova de precisão sob lag e o código mantém `setTimeout` recursivo sem cleanup |
| [mineflayer-death-event@2.0.0](https://github.com/tuanzisama/mineflayer-death-event) | **XFAIL (falha funcional reproduzida)**: emitiu `playerDeath` para `multiplayer.player.joined` e mensagem de sistema genérica; também reconheceu morte real `death.attack.genericKill` de `attacker_probe` | **REJEITADO** até filtrar estritamente eventos `death.*` e comprovar ausência de falsos positivos |
| [mineflayer-bloodhound@0.0.2](https://github.com/Nixes/mineflayer-bloodhound) | **PASS diagnóstico**: após spawn, correlacionou corretamente `attacker_probe` → `cow` (entityId 2 → 3); sem erros | **APENAS LAB**: falta medir falsos positivos, combate com múltiplos alvos, latência, cancelamento e outras formas de dano |

**Diferença crucial:** um PASS de diagnóstico não é autorização para integração ou indicação de vantagem sobre o código próprio. O Death Event passa por um gate de falha esperada (`XFAIL`) quando e somente quando o bug conhecido aparece, a morte real é reconhecida e não há outros erros. XFAIL **não** significa plugin aprovado.

## Problemas de compatibilidade / riscos

### TPS
A implementação upstream usa uma função `run()` que se agenda com `setTimeout(..., 1000)` repetidamente, sem mecanismo de parada. O próprio teste termina seu processo descartável, evitando deixar o temporizador ativo. Antes de usar em bot com reconexões, avaliar alternativa com shutdown explícito, medição correta em janelas quentes (>=20s) e impacto em CPU/listeners.

### Death Event
O código-fonte da versão 2.0.0 identifica mensagens de posição `system` como eventos válidos, sem exigir namespace `death.`. Evidência real: entrar no servidor gerou evento marcado como morte com reason `multiplayer.player.joined`; mensagens genéricas também produziram evento com reason `null`. Se ligado ao estado do bot, isso poderia interromper tarefas ou iniciar recovery injustificado. Não habilitar globalmente.

### Bloodhound
O projeto indica apenas detecção corpo a corpo como suportada, não projéteis; também avisa sobre correlação sensível a latência. Inicialização do plugin acontece após o spawn do Mineflayer: a primeira versão do teste verificava `bot.bloodhound` cedo demais e deu falso erro de setup; a correção foi testada e o cenário real passou. Nenhuma autoridade para revidar deve ser dada ao plugin sem supervisão e testes negativos.

## Próximos testes, ainda não realizados

1. Bloodhound: cenários negativos (dois jogadores próximos, terceiro observador), ataque errado, dois mobs, distância >6, atrasos e testes de false positive.
2. TPS: 30–60s comparando tick real do servidor com estimativa, reinício/reconexão e encerramento sem timers vivos.
3. Death Event: adapter opt-in de filtragem `death.*` com testes de chat, ingresso/saída, mensagens traduzidas e diferentes línguas; sem alterar o `lib/death-recovery.js` até passar.
4. Depois, testes de integração no `index.js`, owner/worker concorrentes, cancelamento, crafting e memória de longo prazo.

## Segurança e rollback

- Não altera `main`, não faz merge, não modifica nenhum servidor existente.
- Não instala novos plugins no runtime principal, nem substitui os sistemas atuais.
- Para qualquer novo recurso, começar desligado por padrão e exigir `PASS` de diagnóstico, teste de integração, comparação com baseline e rollback documentado.
