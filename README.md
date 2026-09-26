# Minecraft Bot de Automação

Bot para Minecraft Forge 26.3 usando **mineflayer**.

## Status Atual

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
├── index.js          # Código principal do bot
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
| `!cancelar` | Cancela a tarefa e volta a seguir |
| `!status` / `!pos` | Mostra vida, fome, itens e posição |
| `!ajuda` | Lista os comandos |
| `!parar` | Desconecta o bot |

O dono é o primeiro jogador online, ou o definido em `MINECRAFT_OWNER`
(nesse caso só ele pode dar comandos). Ao tomar dano, o bot foge do agressor;
com HP baixo, foge de mobs hostis próximos antes de apanhar.
