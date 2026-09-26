# Servidor 24h com o bot

Servidor vanilla 26.3 em `~/minecraft-server` e o bot como serviços do systemd
de usuário: o mundo fica sempre ligado na porta fixa 25565, o bot reconecta
sozinho se cair, e outros PCs da rede (ex.: Windows) entram pelo IP deste PC.

## 1. Servidor

```bash
mkdir -p ~/minecraft-server && cd ~/minecraft-server
# server.jar: link "server" em https://piston-meta.mojang.com/mc/game/version_manifest_v2.json (versão 26.3)
# Java 25 (o 26.3 exige): JRE Temurin 25 extraído em ~/minecraft-server/jre
```

`start.sh`:
```sh
#!/bin/sh
cd "$(dirname "$0")"
exec ./jre/bin/java -Xms1G -Xmx2G -jar server.jar nogui
```

`server.properties` (o resto fica no padrão):
```properties
online-mode=false            # contas TLauncher e bots não são autenticadas pela Mojang
enforce-secure-profile=false
server-port=25565
spawn-protection=0           # bots (não-op) podem construir perto do spawn
```

`eula.txt` com `eula=true` (aceite da EULA: https://aka.ms/MinecraftEULA).

**Segurança:** com `online-mode=false` qualquer um que alcance a porta entra com
qualquer nome. Mantenha o servidor só na rede local — não abra a porta no roteador.

### Levar um mundo do singleplayer

Com o mundo **fechado** no jogo (Salvar e sair), copie `~/.minecraft/saves/<mundo>`
para `~/minecraft-server/world` e apague `session.lock`. No 26.x os dados do
dono do mundo ficam em `players/data/<uuid-da-conta>.dat` (o UUID está em
`singleplayer_uuid` no `level.dat`); no servidor offline o jogador usa o UUID
offline do nome, então copie `data`, `stats` e `advancements` para esse UUID:

```bash
node -e "const h=require('crypto').createHash('md5').update('OfflinePlayer:eduardo').digest();h[6]=h[6]&15|48;h[8]=h[8]&63|128;const x=h.toString('hex');console.log([x.slice(0,8),x.slice(8,12),x.slice(12,16),x.slice(16,20),x.slice(20)].join('-'))"
```

## 2. Firewall (para outros PCs da rede)

```bash
sudo ufw allow from 192.168.0.0/24 to any port 25565 proto tcp
```

## 3. Whitelist

No 26.3 o `server.properties` vem com `white-list=true` por padrão e a lista vazia.
Adicione o dono, o bot e os nomes da colônia (`<papel>_01`..`_12`) em `whitelist.json`
(com UUID offline) ou, como op no jogo, use `/whitelist add <nome>`.

## 4. Serviços

```bash
mkdir -p ~/.config/systemd/user
cp deploy/minecraft-server.service deploy/minecraft-mbot.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now minecraft-server minecraft-mbot
loginctl enable-linger "$USER"   # continua rodando sem ninguém logado
```

Acompanhar: `journalctl --user -u minecraft-mbot -f` (e `-u minecraft-server`).
Parar tudo: `systemctl --user stop minecraft-mbot minecraft-server`.

Sem systemd, `npm run sempre` roda o bot reconectando a cada 15s.

## 5. Entrar do Windows

Minecraft **26.3** (vanilla ou Forge pelo TLauncher) → Multijogador: o servidor
aparece sozinho em "Jogos em LAN", porque o bot o anuncia na rede
(`MINECRAFT_LAN_ANNOUNCE=1` no serviço; nome em `MINECRAFT_LAN_MOTD`, padrão = MOTD
do servidor). Anuncia só pelo endereço da rota padrão, para o mundo não
aparecer duplicado com cabo e Wi-Fi ligados (`MINECRAFT_LAN_ADDRESS` fixa outro).
O anúncio só roda enquanto o bot está ligado. Sem ele, use Conexão
direta → `<IP deste PC>:25565` (veja o IP com `hostname -I`).
