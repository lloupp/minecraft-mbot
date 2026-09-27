# Servidor P0 Forge 1.20.1

Forge **47.4.10** (recommended consultado em 2026-09-27), Java 17, mundo novo separado. Instalador oficial fixado e SHA1 publicado conferido. Sem mods adicionais.

```bash
MBOT_ACCEPT_EULA=1 deploy/forge-1201/setup.sh
systemd-run --user --unit=mbot-forge-1201-test \
  --property=WorkingDirectory=/home/eduardodlima/minecraft/forge-1201-test \
  /home/eduardodlima/minecraft/forge-1201-test/start.sh
```

O destino padrão fica ao lado do repositório: `/home/eduardodlima/minecraft/forge-1201-test` neste ambiente. O setup aceita outro destino como primeiro argumento. Leia https://aka.ms/MinecraftEULA antes de aceitar. Configurações, whitelist, OPs e mundo existentes são preservados; o setup não redefine acesso existente.

Configuração inicial: `127.0.0.1:25586`, survival obrigatório, normal, whitelist, offline, RCON desativado, quatro jogadores no máximo, view-distance=4, simulation-distance=3, heap 256–768 MB. Somente `eduardo` recebe OP. Orquestrador e papéis `_01`/`_02` ficam na whitelist sem OP. `MINECRAFT_OWNER` configura o nome do dono na primeira instalação. O lock impede duas instâncias no mesmo diretório.

O modo offline deve permanecer restrito ao loopback. Para cliente em outra máquina, configure acesso autenticado/túnel separadamente; não exponha esta porta à internet.

## Operação

```bash
journalctl --user -u mbot-forge-1201-test -f
# Console local do servidor novo:
printf '%s\n' 'list' > /home/eduardodlima/minecraft/forge-1201-test/console
# Desligamento com salvamento:
printf '%s\n' 'stop' > /home/eduardodlima/minecraft/forge-1201-test/console
```

O serviço é transitório: não inicia automaticamente após reboot. Espere `Done` no log antes de conectar. Para reiniciar uma unidade transitória encerrada, `systemctl --user reset-failed mbot-forge-1201-test` se necessário, e repita systemd-run. Alternativamente, execute start.sh em terminal dedicado.

## EduardoBot

Use estado separado, para não restaurar projetos do servidor anterior:

```bash
MINECRAFT_HOST=127.0.0.1 MINECRAFT_PORT=25586 \
MINECRAFT_VERSION=1.20.1 MINECRAFT_PROFILE=forge MINECRAFT_OWNER=eduardo \
MAX_COLONY_BOTS=2 COLONY_STATE_FILE=.data/forge-p0/colony-state.json \
MEMORY_FILE=.data/forge-p0/memory.json COLONY_EVENT_LOG=.data/forge-p0/events.jsonl \
node index.js
```

O comando isola StateStore, memória e EventLog dos outros mundos usando as variáveis existentes. A instalação do servidor não comprova crafting, coleta, combate, logística ou checkpoint: cada cenário precisa de evidência própria.

## Smoke limitado com dois workers

Execute da raiz do repositório, após `Done` no servidor:

```bash
node deploy/forge-1201/smoke.js
```

Usa o mesmo perfil Forge, factory, plugins já instalados e WorkerController. Conecta apenas `eduardo_bot`, `lenhador_01` e `minerador_01`, escolhe posições carregadas com chão sólido e ar nos pés/cabeça, e manda duas tarefas `ir_local` simultaneamente. Não constrói nem fornece itens. Limite total de 90 segundos; desconecta e cancela ao terminar. Registra posições, saúde, modo de jogo, erros e CPU do processo Node em `.data/forge-p0/smoke-evidence.json`. A confirmação usa distância ao centro do bloco de destino, raio de 2 blocos com tolerância de 0,01. Não use junto com uma sessão que já ocupa esses nomes. Antes de repetir, copie as evidências; o arquivo da sessão é sobrescrito.

Este smoke não valida coleta, estoque, crafting, furnace, combate, cancelamento em viagem, restart de objetivos ou desempenho prolongado. CPU registrada é a do executor Node durante essa sessão, não CPU do servidor nem da aplicação completa.
