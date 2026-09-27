#!/bin/bash
# Instala Forge fixado, com mundo próprio. Não sobrescreve configuração existente.
set -euo pipefail
SRC=$(cd "$(dirname "$0")" && pwd)
DEST=${1:-"$SRC/../../../forge-1201-test"}
mkdir -p "$DEST"
DEST=$(cd "$DEST" && pwd)
JAVA=${JAVA_BIN:-/usr/bin/java}
VERSION=1.20.1-47.4.10
SHA1=66bfea9963bfa60d88bab6b2750e74a958392715
if [[ ! -f "$DEST/eula.txt" ]] && [[ ${MBOT_ACCEPT_EULA:-0} != 1 ]]; then
  echo 'Leia https://aka.ms/MinecraftEULA e use MBOT_ACCEPT_EULA=1 para aceitar.' >&2
  exit 1
fi
if [[ ! -f "$DEST/forge-installer.jar" ]]; then
  curl -fL --retry 2 -o "$DEST/forge-installer.jar.download" "https://maven.minecraftforge.net/net/minecraftforge/forge/$VERSION/forge-$VERSION-installer.jar"
  echo "$SHA1  $DEST/forge-installer.jar.download" | sha1sum -c -
  mv "$DEST/forge-installer.jar.download" "$DEST/forge-installer.jar"
fi
echo "$SHA1  $DEST/forge-installer.jar" | sha1sum -c -
if [[ ! -f "$DEST/libraries/net/minecraftforge/forge/$VERSION/unix_args.txt" ]]; then
  (cd "$DEST" && "$JAVA" -Xmx512M -jar forge-installer.jar --installServer > install.log 2>&1)
fi
cp "$SRC/start.sh" "$DEST/start.sh"
chmod +x "$DEST/start.sh"
if [[ ! -f "$DEST/eula.txt" ]]; then echo 'eula=true' > "$DEST/eula.txt"; fi
if [[ ! -f "$DEST/user_jvm_args.txt" ]]; then
  printf '%s\n' '-Xms256M' '-Xmx768M' > "$DEST/user_jvm_args.txt"
elif ! grep -q '^-Xmx' "$DEST/user_jvm_args.txt"; then
  # Preserva flags existentes no arquivo gerado pelo instalador.
  if ! grep -q '^-Xms' "$DEST/user_jvm_args.txt"; then echo '-Xms256M' >> "$DEST/user_jvm_args.txt"; fi
  echo '-Xmx768M' >> "$DEST/user_jvm_args.txt"
fi
if [[ ! -f "$DEST/server.properties" ]]; then
  cat > "$DEST/server.properties" <<'PROPS'
server-ip=127.0.0.1
server-port=25586
online-mode=false
enforce-secure-profile=false
white-list=true
spawn-protection=0
gamemode=survival
force-gamemode=true
difficulty=normal
max-players=4
view-distance=4
simulation-distance=3
level-seed=eduardobot-forge-p0
motd=EduardoBot P0 Forge 1.20.1
allow-flight=false
enable-rcon=false
PROPS
fi
MBOT_SERVER_DEST="$DEST" MINECRAFT_OWNER="${MINECRAFT_OWNER:-eduardo}" node "$SRC/whitelist.js"
echo "Forge $VERSION pronto em $DEST; endereço padrão 127.0.0.1:25586."
