#!/usr/bin/env bash
# Inicia o servidor pz-server (Forge 1.20.1).
#
#   ./start-server.sh                 # 4 GB de heap
#   MC_RAM=6G ./start-server.sh       # mais RAM
#   BACKUP=0 ./start-server.sh        # pula o backup do mundo
#
# Variáveis: MC_RAM (heap máximo, padrão 4G), MC_MIN_RAM (padrão 1G),
# JAVA (padrão java), BACKUP (1/0), BACKUP_KEEP (quantos backups manter, padrão 5).
cd "$(dirname "$0")" || exit 1

MC_RAM="${MC_RAM:-4G}"
MC_MIN_RAM="${MC_MIN_RAM:-1G}"
JAVA="${JAVA:-java}"
BACKUP="${BACKUP:-1}"
BACKUP_KEEP="${BACKUP_KEEP:-5}"

pause_if_terminal() {
  if [ -t 0 ]; then read -r -p "Pressione Enter para fechar..." _; fi
}

fail() {
  echo
  echo "================================================================"
  echo " ERRO: $*"
  echo "================================================================"
  pause_if_terminal
  exit 1
}

command -v "$JAVA" >/dev/null 2>&1 || fail "Java não encontrado. Instale o Java 17 ou defina JAVA=/caminho/bin/java."
FORGE=$(python3 -c "import json;d=json.load(open('mods.lock.json'));print(d['minecraft']+'-'+d['forge'])" 2>/dev/null) || FORGE=1.20.1-47.4.10
ARGS="libraries/net/minecraftforge/forge/$FORGE/unix_args.txt"
[ -f "$ARGS" ] || fail "Forge $FORGE não instalado. Rode ./install-server.sh --accept-eula primeiro."
grep -qs '^eula=true' eula.txt || fail "EULA não aceita. Rode ./install-server.sh --accept-eula."

# Backup do mundo antes de iniciar (o servidor está parado, então a cópia é consistente).
if [ "$BACKUP" = 1 ] && [ -d world ]; then
  mkdir -p backups
  NAME="backups/world-$(date +%Y%m%d-%H%M%S).tar.gz"
  echo "Backup do mundo em $NAME..."
  tar -czf "$NAME" world || fail "backup do mundo falhou (disco cheio?). Use BACKUP=0 para pular."
  ls -1t backups/world-*.tar.gz 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) | xargs -r rm -f
fi

echo "Iniciando Forge $FORGE com ${MC_RAM} de RAM..."
"$JAVA" -Xms"$MC_MIN_RAM" -Xmx"$MC_RAM" \
  -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 \
  -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC \
  -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M \
  -XX:G1ReservePercent=20 -XX:InitiatingHeapOccupancyPercent=15 \
  @"$ARGS" nogui "$@"
CODE=$?

if [ $CODE -ne 0 ]; then
  echo
  echo "---- últimas linhas de logs/latest.log ----"
  tail -n 25 logs/latest.log 2>/dev/null
  CRASH=$(ls -1t crash-reports/*.txt 2>/dev/null | head -n 1)
  [ -n "$CRASH" ] && echo "Relatório de crash mais recente: $CRASH"
  fail "o servidor terminou com código $CODE. Veja TROUBLESHOOTING.md."
fi
echo "Servidor encerrado normalmente."
