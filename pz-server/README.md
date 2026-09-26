# pz-server: sobrevivência zumbi estilo Project Zomboid

Servidor dedicado **Minecraft 1.20.1 + Forge 47.4.10**: cidades abandonadas (The Lost
Cities), zumbis que ouvem e farejam (Zombie Awareness), hordas periódicas que crescem
(The Hordes), armas de fogo raras (TaCZ), ferimentos por parte do corpo (First Aid),
temperatura (Cold Sweat), comida que estraga (Spoiled), corpos com os itens (Corpse),
mochilas e fortificação (SecurityCraft).

| | |
|---|---|
| Minecraft | 1.20.1 |
| Loader | Forge **47.4.10** (versão *recommended*; nada de Fabric/NeoForge) |
| Java | **17** (testado com Temurin 17.0.20) |
| Mods | 30 no servidor, 33 no cliente, versões fixas em [`mods.lock.json`](mods.lock.json) |
| RAM do servidor | 4 GB (até ~4 jogadores), 6 GB (5–8 jogadores) |
| RAM do cliente | 4,5–5 GB num PC de 8 GB |

Documentos: [MODS.md](MODS.md) · [SERVER-MODS.md](SERVER-MODS.md) ·
[CLIENT-MODS.md](CLIENT-MODS.md) · [CONFIGURATION.md](CONFIGURATION.md) ·
[TROUBLESHOOTING.md](TROUBLESHOOTING.md)

## Instalar o servidor

Pré-requisitos: **Java 17** ([Temurin 17](https://adoptium.net/temurin/releases/?version=17))
e internet. No Linux também `python3`, `curl` e `sha1sum`.

A pasta `pz-server/` **é** a pasta do servidor: os scripts baixam o Forge e os mods
para dentro dela.

**Linux**
```bash
cd pz-server
./install-server.sh --accept-eula     # aceita a EULA: https://aka.ms/MinecraftEULA
./start-server.sh
```

**Windows** (PowerShell)
```powershell
cd pz-server
powershell -ExecutionPolicy Bypass -File install-server.ps1 -AcceptEula
start-server.bat
```

O instalador confere o SHA-1 do instalador do Forge e o SHA-512 de cada mod. Rodar de
novo é seguro: só baixa o que falta ou mudou. O primeiro start cria o mundo
(≈ 1 min) e mostra `Done (...)! For help, type "help"`.

## Iniciar

```bash
./start-server.sh                 # 4 GB de heap
MC_RAM=6G ./start-server.sh       # mais RAM
BACKUP=0 ./start-server.sh        # sem backup nesse start
```
No Windows: `set MC_RAM=6G` e depois `start-server.bat`.

A cada start o script faz **backup do mundo** em `backups/world-AAAAMMDD-HHMMSS.tar.gz`
(mantém os 5 últimos; `BACKUP_KEEP=10` muda isso). Se o servidor cair, o script mostra o
fim do `logs/latest.log`, aponta o relatório em `crash-reports/` e espera Enter antes
de fechar. Para desligar, digite `stop` no console (salva o mundo).

Logs: `logs/latest.log` (e `logs/debug.log` para detalhes). Crashes: `crash-reports/`.

## Preparar o cliente (cada jogador)

1. Instale o **Forge 1.20.1 – 47.4.10** (qualquer 47.x ≥ 47.3.30 também conecta; o
   SecurityCraft exige no mínimo 47.3.30). No TLauncher, escolha a versão
   "Forge 1.20.1" mais recente da lista; no launcher oficial, use o
   [instalador do Forge](https://files.minecraftforge.net/net/minecraftforge/forge/index_1.20.1.html)
   (47.4.10) e depois abra o perfil "forge".
2. Rode o perfil uma vez e feche (cria a pasta `mods`).
3. Instale os mods do cliente (a lista está em [CLIENT-MODS.md](CLIENT-MODS.md)):
   - Windows: `powershell -ExecutionPolicy Bypass -File install-client.ps1`
     (usa `%APPDATA%\.minecraft\mods`; outra pasta: `-ModsDir "C:\...\mods"`)
   - Linux: `./install-client.sh` (ou `./install-client.sh /caminho/mods`)
   Mods antigos que não estão na lista vão para `mods-removidos/`, nada é apagado.
4. RAM do jogo: **4,5–5 GB** num PC de 8 GB (no TLauncher: Configurações → memória;
   no launcher oficial: argumentos JVM `-Xmx5G`). Mais que isso deixa o Windows sem memória.
5. Shaders não são necessários. O Embeddium e o Entity Culling já vêm na lista.

## Entrar no servidor

Multijogador → Adicionar servidor → endereço `IP-do-servidor:25565`.
- Mesma rede: IP local do PC do servidor (ex.: `192.168.0.10`).
- Pela internet: redirecione a porta TCP 25565 no roteador ou use uma VPN de jogo
  (Radmin VPN, ZeroTier, Tailscale).

O servidor usa `online-mode=false` para aceitar contas do TLauncher (e o bot). Isso quer
dizer que **qualquer um pode entrar com qualquer nome**; ative a whitelist:
```
whitelist add SeuNome
whitelist on
```
(e `enforce-whitelist=true` no `server.properties` para expulsar quem não está na lista).

## Atualizar

- **Mods e Forge:** as versões ficam no `mods.lock.json`. Para ver o que tem versão nova:
  `python3 tools/modpack.py check-updates`. Para atualizar um mod, troque `version`,
  `file`, `url`, `sha512` e `size` pela versão nova do Modrinth, rode
  `python3 tools/modpack.py docs`, depois `./install-server.sh` (o jar antigo vai para
  `mods-removidos/`) e teste com um backup do mundo. Os jogadores rodam o
  `install-client` de novo.
- **Configs deste repositório:** `git pull` e reinicie o servidor. Loot e spawners
  (datapack) também podem ser recarregados sem reiniciar com `/reload`.

## Adicionar ou remover mods

1. Confirme no Modrinth que o mod tem build para **Forge 1.20.1** (não Fabric/NeoForge)
   e se é de cliente, servidor ou ambos.
2. Adicione (ou remova) a entrada em `mods.lock.json` com `slug`, `name`, `version`,
   `side` (`server`, `client` ou `both`), `file`, `url`, `sha512`, `size`, `page`,
   `reason` e `depends_on` (inclua também as dependências).
3. `python3 tools/modpack.py docs` para atualizar MODS.md, SERVER-MODS.md e CLIENT-MODS.md.
4. `./install-server.sh` e inicie o servidor com um backup; confira que chega em `Done`
   sem `ERROR` novo no log.
5. Se o mod for `both` ou `client`, todos os jogadores precisam rodar o `install-client`.

Nunca misture mods de Fabric/NeoForge: o Forge não carrega ou o servidor quebra.

## Estrutura

```
pz-server/
├── install-server.sh / .ps1   # instala Forge + mods do servidor (confere hashes)
├── start-server.sh / .bat     # inicia com RAM configurável, backup e erro claro
├── install-client.sh / .ps1   # baixa os mods do cliente
├── mods.lock.json             # versões fixas, URLs oficiais, SHA-512, lado de cada mod
├── server.properties          # configuração do servidor
├── config/                    # configs ajustadas dos mods (só as que mudamos)
├── defaultconfigs/            # configs copiadas para cada mundo novo (Lost Cities)
├── moonlight-global-datapacks/pz-survival/   # loot, spawners de prédio, receitas TaCZ
└── tools/
    ├── modpack.py             # download / docs / check-updates
    ├── build_datapack.py      # gera o datapack pz-survival
    └── MODS-decisoes.md       # decisões de escolha de mods (entra no MODS.md)
```
O `.gitignore` deixa fora jars, mundo, backups e logs.
