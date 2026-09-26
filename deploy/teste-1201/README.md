# Servidor de teste 1.20.1

Servidor **vanilla 1.20.1** separado do servidor 24h (26.3), para testar o bot
sem mexer no mundo principal. Roda na porta **25566**, com seed fixa
`mbot-teste`, e aceita comandos de console por um FIFO.

## Pré-requisitos

- Java 17 em `/usr/bin/java` (ex.: `sudo apt install openjdk-17-jre-headless`)
- Node.js 22+ (o `setup.sh` usa o `node` para gerar a whitelist)

## Montar

```bash
deploy/teste-1201/setup.sh              # destino padrão: ~/minecraft-server-1201
deploy/teste-1201/setup.sh /outro/dir   # ou outro diretório
```

O script:

- baixa o `server.jar` 1.20.1 oficial e confere o SHA1;
- grava `eula.txt` (aceite da EULA: https://aka.ms/MinecraftEULA);
- cria o `server.properties` só se ainda não existir: porta 25566,
  `online-mode=false`, whitelist ligada, `spawn-protection=0`, seed `mbot-teste`;
- gera `whitelist.json` com UUID offline para o dono (`MINECRAFT_OWNER`, padrão
  `eduardo`), `eduardo_bot` e os papéis da colônia `_01`..`_12`, e `ops.json`
  com o dono e o `eduardo_bot`.

Rodar de novo é seguro: mantém o `server.properties` e o mundo, e regrava a
whitelist e os ops.

## Subir e parar

```bash
systemd-run --user --unit=mc-teste-1201 \
  --working-directory=$HOME/minecraft-server-1201 $HOME/minecraft-server-1201/start.sh
journalctl --user -u mc-teste-1201 -f     # logs
systemctl --user stop mc-teste-1201        # para e salva o mundo
```

A unidade é transitória: não volta sozinha depois de um reboot nem se o
servidor cair.

## Console

O `start.sh` cria o FIFO `console` no diretório do servidor:

```bash
echo "whitelist add miguinho" > ~/minecraft-server-1201/console
echo "op construtor_01" > ~/minecraft-server-1201/console
```

## Conectar o bot

```bash
MINECRAFT_HOST=127.0.0.1 MINECRAFT_PORT=25566 MINECRAFT_VERSION=1.20.1 \
MINECRAFT_PROFILE=vanilla1201 MINECRAFT_OWNER=eduardo node index.js
```

O `minecraft-mbot.service` aponta para a porta 25565 (servidor 26.3), então
para testes rode o bot manualmente como acima.

## Replicar o mesmo mundo

A seed igual gera o mesmo terreno, mas não o que foi construído. Para levar o
mundo, pare o servidor, copie a pasta `world/` e apague `world/session.lock`.

**Segurança:** com `online-mode=false` qualquer um que alcance a porta entra
com um nome da whitelist. Deixe o servidor só na rede local ou no localhost.
