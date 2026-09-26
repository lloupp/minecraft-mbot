#!/usr/bin/env bash
# Instala/atualiza o servidor Forge 1.20.1 do pz-server nesta pasta.
#
#   ./install-server.sh --accept-eula      # primeira instalação
#   ./install-server.sh                    # atualizar (mods/Forge conforme mods.lock.json)
#
# Requisitos: Java 17 (JAVA=/caminho/java para escolher outro), python3, internet.
# Nunca apaga o mundo; mods fora do lock são movidos para mods-removidos/.
set -euo pipefail
cd "$(dirname "$0")"

die() { echo; echo "ERRO: $*" >&2; exit 1; }

JAVA="${JAVA:-java}"
command -v "$JAVA" >/dev/null 2>&1 || die "Java não encontrado. Instale o Java 17 (Temurin: https://adoptium.net/temurin/releases/?version=17) ou defina JAVA=/caminho/bin/java."
command -v python3 >/dev/null 2>&1 || die "python3 não encontrado (usado para baixar e conferir os mods)."
JAVA_MAJOR=$("$JAVA" -XshowSettings:properties -version 2>&1 | awk -F'= ' '/java.specification.version/ {print $2}')
[ "${JAVA_MAJOR:-0}" -ge 17 ] 2>/dev/null || die "Java $JAVA_MAJOR encontrado; o Forge 1.20.1 precisa do Java 17."
[ "$JAVA_MAJOR" = 17 ] || echo "Aviso: Java $JAVA_MAJOR detectado. O recomendado e testado é o Java 17."

if [ "${1:-}" = "--accept-eula" ]; then
  echo "eula=true" > eula.txt
elif ! grep -qs '^eula=true' eula.txt; then
  die "É preciso aceitar a EULA do Minecraft (https://aka.ms/MinecraftEULA). Rode: ./install-server.sh --accept-eula"
fi

read_lock() { python3 -c "import json;d=json.load(open('mods.lock.json'));print($1)"; }
FORGE=$(read_lock "d['minecraft']+'-'+d['forge']")
URL=$(read_lock "d['forge_installer']['url']")
SHA1=$(read_lock "d['forge_installer']['sha1']")

if [ ! -f "libraries/net/minecraftforge/forge/$FORGE/unix_args.txt" ]; then
  echo "== Instalando Forge $FORGE"
  curl -fL --retry 3 -o forge-installer.jar "$URL" || die "falha ao baixar o instalador do Forge"
  echo "$SHA1  forge-installer.jar" | sha1sum -c --quiet || die "SHA-1 do instalador do Forge não confere"
  "$JAVA" -jar forge-installer.jar --installServer . > forge-install.log 2>&1 || die "instalação do Forge falhou (veja forge-install.log)"
  rm -f forge-installer.jar run.sh run.bat
else
  echo "== Forge $FORGE já instalado"
fi

echo "== Mods do servidor"
python3 tools/modpack.py download --side server --dest mods || die "download dos mods falhou"

echo
echo "Pronto. Inicie com: ./start-server.sh   (RAM: MC_RAM=6G ./start-server.sh)"
