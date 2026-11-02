# Sessão autônoma — 2026-11-01

O uso pretendido: o bot joga sozinho, sem ninguém dando ordens.

- Servidor vanilla 1.20.1 oficial, mundo novo (seed `mbot-campo-1`),
  survival, easy, monstros, ciclo dia/noite natural, **ninguém online**.
- Perfil `examples/minecraft-mbot-autonomous.env` sem alterações (só host,
  porta e arquivos de estado). Nenhum item dado, nenhum comando enviado.
- 30 min (1,5 dia de jogo), amostra a cada 30 s pelo console do servidor.
- Roteiro: `scripts/autonomy-trial.js`.

## O que aconteceu

| Minuto | Marco |
|---|---|
| 0,5 | tábuas e picareta de madeira |
| 1 | picareta e espada de pedra (e machado logo depois) |
| 2 | fornalha e carvão |
| 4 | minério de ferro |
| 8 | primeiros lingotes de ferro |
| 11–20 | noite: cava um abrigo a y=22 e fica parado, protegido |
| 20–30 | dia: continua no subsolo, fundindo ferro e tentando achar madeira |

Fim da sessão: **0 mortes**, vida mínima 18,5/20, 11 lingotes de ferro, 118
pedregulhos, 25 carvões. Mas **nenhuma ferramenta de ferro, nenhuma armadura,
sem picareta nenhuma** (as de pedra gastaram) e **fome 6/20 sem comida**
(comeu carne podre).

## Por que travou

1. **Fica sem madeira e não volta à superfície.** Depois do abrigo noturno
   ele segue no subsolo; cada receita que precisa de graveto ou tábua pede
   "Coletando troncos para oak_planks", que falha lá embaixo (busca a até 48
   blocos). Sem graveto não faz picareta de ferro, mesmo com 11 lingotes, nem
   repõe a picareta gasta.
2. **Fabricar tábuas falhou 5 vezes seguidas** logo depois de usar a
   fornalha (`bot.craft` sem confirmação do servidor; a mensagem diz "a mesa
   não confirmou", mas era a grade 2x2 do inventário). Tinha 4 troncos e
   continuou com eles.
3. **Comida só é buscada com fome**, e no subsolo não há animais: a meta
   "estoque de comida" falhou 4 vezes.
4. **Depois do ferro não há mais metas**: a lista termina em equipamento de
   ferro e escudo; daí em diante o bot só explora ao acaso.
5. **A colônia não começa sozinha num mundo novo**: `MBOT_COLONY_AUTOSTART`
   exige base, estoque e workers já salvos, e nada no modo autônomo os cria.

## Correções e sessões seguintes (mesma seed, mesmo perfil, 30 min cada)

| | Sessão 1 (antes) | Sessão 2 | Sessão 4 | Sessão 5 |
|---|---|---|---|---|
| Picareta/espada de pedra | 1 min | 1,5 min | 1 min | 1–1,5 min |
| Comida obtida sozinho | não (carne podre) | não | 9,7 min (vacas, porco, cozinhou) | 8,6 min |
| Lingote de ferro | 8 min | 5,6 min | 10,7 min | 10,2 min |
| Picareta de ferro | nunca | 10 min | — (morreu antes) | 15 min |
| Armadura de ferro | nunca | 20 min | — | — |
| Mortes | 0 | 1 (creeper numa caverna) | 1 (afogado) | 2 (afogado) |
| Depois de morrer | — | **parado 8 min** | reconstruiu até pedra + tochas | reconstruiu |

O que mudou entre elas:

1. **Craft na grade 2x2** (`lib/craft.js`): uma unidade por vez, fechando a
   tela do inventário e sincronizando. Reproduzido isolado: a cadeia tábuas →
   gravetos → tochas deixava o servidor sem as tochas que o bot achava ter.
2. **Madeira** (`lib/autonomy.js`): estoque mínimo; volta ao último ponto com
   céu à vista e, sem árvore, anda procurando.
3. **Comida**: urgente no topo só com fome; estoque de 4 itens depois das
   ferramentas de pedra (no topo, a sessão 3 vagou 9 min sem pegar nada e foi
   interrompida).
4. **Morrer travava o bot** (bug desde o `index.js` original): o modo ficava
   em "tarefa". Corrigido; sessões 4 e 5 mostram o bot recomeçando.
5. **Ar** (`lib/water.js`): abaixo de 14/20 larga a tarefa e vai ao ponto
   seco mais perto. Num teste dirigido (caixa de água 7x6x7) saiu com vida
   cheia.

## O que ainda falta

- **Água continua sendo a maior causa de morte.** O guarda de ar dispara
  (12 vezes na sessão 5), mas o caminho do pathfinder atravessa água: o bot
  sobe para respirar, a meta o manda de volta e às vezes ele não acha saída
  (ar −1). O próximo passo é deixar a água cara no pathfinder (`liquidCost`)
  para ele não mergulhar.
- **Creeper numa caverna**: a regra é sempre fugir, mesmo com espada de ferro;
  sem espaço para fugir, ele explode.
- **Recuperar itens depois de morrer**: `lib/death-recovery.js` existe mas não
  é usado; hoje tudo se perde.
- Depois do ferro não há metas (base, cama, fazenda) e a colônia não começa
  sozinha num mundo novo.
