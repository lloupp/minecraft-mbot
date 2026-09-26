# Minecraft Bot de Automação

Bot para Minecraft Forge 26.3 usando **mineflayer**.

## Status Atual

O `eduardo_bot` agora também funciona como **orquestrador da colônia**. Ele pode criar e remover bots auxiliares, consultar o registro de itens/blocos do Minecraft e montar planos simples de crafting a partir das receitas disponíveis no Mineflayer.


| Item | Status |
|------|--------|
| **Versão do jogo** | Forge 26.3 (Protocolo 777) ✅ |
| **Conexão** | Funciona ✅ |
| **Chat via bot** | Funciona ✅ |
| **Spawn completo** | Funciona ✅ |
| **Movimentação** | Requer `minecraft-data` com suporte nativo a 26.3 ⏳ |

## Pré-requisitos

- Java 17+ ✅
- Node.js 22+ ✅
- TLauncher com Minecraft 1.20.1 Forge 26.3 ✅

## Como usar

### 1. Abra o mundo no modo LAN
1. Abra o TLauncher e entre no mundo **"Novo mundo"**
2. No jogo, pressione **Esc** > **"Abrir para LAN"**
3. Ative "Permitir cheats"

### 2. Configure o bot (opcional)
O bot detecta sozinho a porta do mundo LAN (procura portas abertas pelo Java
e faz um ping de status) e usa a versão anunciada pelo servidor.
Para forçar valores:

```bash
MINECRAFT_PORT=25565 MINECRAFT_VERSION=26.3 node index.js
```

Se o servidor estiver em outra máquina, configure `MINECRAFT_HOST` e
`MINECRAFT_PORT` (a detecção automática só funciona para servidor local).

### 3. Rode o bot
```bash
npm install
node index.js
```

## Estrutura

```
minecraft-mbot/
├── index.js          # Conexão, estados, fuga e comandos
├── lib/
│   ├── food.js       # Comer e buscar comida
│   ├── craft.js      # Fabricar (com mesa) e usar a fornalha
│   ├── gather.js     # Coletar blocos (pula os inalcançáveis)
│   └── perception.js # Reconhecer blocos e entidades em volta
├── package.json      # Dependências
├── node_modules/     # Pacotes instalados
└── README.md         # Este arquivo
```

## Notas Técnicas

O Forge 26.3 usa o protocolo **777**, que é muito recente e ainda não tem suporte nativo em `minecraft-data`. O `minecraft-data` (versão 3.117.0) lista `26.1` como a última versão suportada.

Foram feitas as seguintes modificações para enable o bot:
- Adicionada entrada `26.3` ao `data.js` do `minecraft-data`
- Criada pasta `data/pc/26.3/` baseada em `26.1`
- Adicionado `26.3` ao `testedVersions` do `mineflayer`
- Adicionado `26.3` ao `prismarine-chunk`

Para funcionalidade completa (movimentação, blocos, inventário), aguarde `minecraft-data` adicionar suporte nativo ao protocolo 26.3.

## Troubleshooting

- **"name_taken"**: O username do bot já está em uso. Use um nome diferente.
- **"ECONNREFUSED"**: O servidor LAN não está ativo. Abra o mundo em LAN no jogo.
- **Porta diferente / detecção falhou**: use `MINECRAFT_PORT=<porta exibida pelo Minecraft> node index.js`.
- **Bot conecta mas não entra no mundo**: não use `version: false` nem desative os plugins `physics`/`blocks`; sem eles o servidor nunca completa o spawn.
- **"chunk size" warnings**: Esperado — protocolo incompleto, não é fatal para chat.
- **"unsupported protocol version"**: defina `MINECRAFT_VERSION=26.3`.

## Comandos no chat

| Comando | O que faz |
|---|---|
| `!seguir` | Segue o dono (padrão ao entrar) |
| `!ficar` | Fica parado onde está |
| `!minerar <bloco> [qtd]` | Minera blocos próximos, ex.: `!minerar oak_log 5` |
| `!fabricar <item> [qtd]` | Fabrica o item, coletando madeira/pedra e fazendo a mesa se precisar, ex.: `!fabricar wooden_pickaxe` |
| `!cozinhar [item] [qtd]` | Sem item: cozinha a comida crua. Com item: usa a fornalha, ex.: `!cozinhar raw_iron` |
| `!comer` | Come a melhor comida do inventário |
| `!comida` | Sai para buscar comida |
| `!ver` | Descreve o que vê: bloco sob os pés, recursos e mobs por perto |
| `!cancelar` | Cancela a tarefa e volta a seguir |
| `!status` / `!pos` | Mostra vida, fome, itens e posição |
| `!ajuda` | Lista os comandos |
| `!parar` | Desconecta o orquestrador e encerra os bots auxiliares |
| `!bot criar [papel] [qtd]` | Cria bots auxiliares, ex.: `!bot criar minerador 3` |
| `!bot remover <nome>` | Remove um bot da colônia |
| `!bots` / `!colonia` | Mostra tamanho, papéis e estado da colônia |
| `!item <nome>` | Consulta item/bloco no registro do Minecraft |
| `!receita <item> [qtd]` | Verifica receita e materiais que faltam no inventário |

O dono é o primeiro jogador online, ou o definido em `MINECRAFT_OWNER`
(nesse caso só ele pode dar comandos). Ao tomar dano, o bot foge do agressor;
com HP baixo, foge de mobs hostis próximos antes de apanhar.

### Fome
Com fome (≤ 14), o bot come a melhor comida que tiver (evita carne podre, frango
cru etc., salvo em emergência). Sem comida, busca a fonte mais próxima num raio
de 48 blocos: caça vacas, porcos, ovelhas, galinhas e coelhos (poupando os 2
últimos de cada espécie para se reproduzirem), colhe cenoura, batata e beterraba
maduras (replantando) e frutas de arbustos. Se não achar nada, avisa uma vez no chat.


## Colônia de bots

Papéis disponíveis nesta primeira versão:

- `minerador`
- `lenhador`
- `fazendeiro`
- `construtor`
- `explorador`
- `guarda`
- `ajudante`

Exemplos:

```text
!bot criar minerador 3
!bot criar fazendeiro 2
!bots
!item iron_pickaxe
!receita iron_pickaxe 2
!bot remover minerador_01
```

O limite padrão é de **12 bots contando o orquestrador**. Pode ser alterado com:

```bash
MAX_COLONY_BOTS=8 node index.js
```

Nesta etapa os bots auxiliares já entram no mundo, recebem um papel e são gerenciados pelo `BotManager`. A execução autônoma específica de cada profissão será construída sobre essa base.

## Arquitetura do orquestrador

```text
Você
  ↓
eduardo_bot
  ├── CommandRouter
  ├── MinecraftKnowledge
  ├── Planner
  └── BotManager
        ├── minerador_01
        ├── lenhador_01
        ├── fazendeiro_01
        └── ...
```

- **CommandRouter**: interpreta os novos comandos da colônia.
- **MinecraftKnowledge**: consulta itens, blocos, alimentos e receitas do registro carregado pelo Minecraft.
- **Planner**: calcula o que já pode ser fabricado e quais ingredientes ainda faltam.
- **BotManager**: cria, acompanha e encerra os bots auxiliares.
