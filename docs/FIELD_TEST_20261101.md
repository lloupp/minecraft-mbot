# Teste de campo — 2026-11-01

Como o bot se comporta quando um jogador o usa num servidor de verdade.

- Servidor: vanilla 1.20.1 oficial (SHA-1 conferido), terreno normal, seed
  `mbot-campo-1`, survival, dificuldade easy, monstros e animais ligados.
- O bot não tem OP. O "dono" é um cliente em modo criativo que só dá ordens
  pelo chat. Os comandos de console servem para preparar a cena (levar o dono
  a um lugar, criar um zumbi, dar pão) e para **medir**: posição, vida, fome,
  inventário e baú são lidos do servidor, não do que o bot responde.
- Roteiro reproduzível: `scripts/field-trial.js`.

```bash
python3 scripts/download-vanilla-server.py --version 1.20.1 --output .cache/vanilla-1.20.1.jar
MBOT_TEST_SERVER_JAR=.cache/vanilla-1.20.1.jar MBOT_TEST_EULA_ACCEPTED=1 \
  MBOT_FIELD_OUTPUT_DIR=field-evidence node scripts/field-trial.js
```

## Resultado (rodada final): 11/12, 0 mortes, 0 expulsões

| Cenário | Resultado | Medido |
|---|---|---|
| Entrar no mundo | ✅ | 8 s até o spawn, vida 20 |
| `!ajuda` (6 linhas) | ✅ | continua online; antes da correção era expulso por spam |
| Seguir o dono 3× (~30 blocos) | ✅ | alcança em 5–7 s, termina a 2 blocos |
| `!minerar oak_log 4` | ✅ | +4 troncos no inventário em 26 s |
| `!fabricar` mesa e picareta de madeira | ✅ | picareta no inventário (a mesa foi usada e colocada) |
| Comer com fome | ✅ | fome 12 → 17, comeu 1 pão sozinho |
| Zumbi a 5 blocos | ✅ | morto em 12 s, bot com 19,5/20 |
| Creeper a 4 blocos | ✅ | afastou-se 6 blocos, sem dano de explosão |
| `!local salvar` + `!ir` (40 blocos) | ✅ | chegou a 2 blocos do marco em 17 s |
| Colônia numa floresta, 2 lenhadores, 4 min | ❌ | só 10 troncos no baú (meta do teste: 16) |
| Noite com monstros (2,5 min) | ✅ | ninguém morreu; vida mínima de um lenhador 14/20 |
| `!parar` + reinício | ✅ | 2 lenhadores e base restaurados |

## Bugs encontrados e corrigidos

1. **`!ajuda` derrubava o bot** ("Kicked for spamming"). O mineflayer manda
   todos os pedaços de uma mensagem longa de uma vez. Corrigido com
   `lib/chat-throttle.js`, que simula o contador anti-spam do servidor.
2. **`!parar` apagava a colônia salva.** O estado era salvo de novo depois de
   `stopAll()`, já sem workers; ao reiniciar, a colônia voltava vazia.
3. A primeira versão da correção 1 quebrava a inicialização (`bot.chat` só
   existe depois do login). Os testes unitários não pegaram; o teste de campo sim.

## Limitações observadas (não corrigidas)

- **Lenhadores rendem pouco.** Numa floresta, cerca de 1,5 tronco por minuto
  por lenhador, e o primeiro depósito só depois de ~3 min. No log: 14 de 60
  cortes sem o item recolhido (`ITEM_NOT_CONFIRMED`, o tronco cai longe ou
  fica na folhagem), 5 caminhos esgotando o tempo entre árvores e um depósito
  que desistiu ("demorei demais para chegar ao estoque").
- **Lenhador não procura árvores longe.** Ele só busca troncos a 48 blocos
  (`lib/gather.js`). Numa rodada com a base no spawn (poucas árvores), os
  lenhadores pegaram 2 troncos e ficaram ociosos com `RESOURCE_NOT_FOUND`.
  Procurar mais longe hoje depende da memória do mundo (`MBOT_WORLD_MEMORY`),
  desligada por padrão.
