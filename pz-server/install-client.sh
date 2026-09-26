#!/usr/bin/env bash
# Baixa os mods do CLIENTE (Forge 1.20.1) para a pasta mods do seu Minecraft.
#   ./install-client.sh                       # ~/.minecraft/mods
#   ./install-client.sh /caminho/para/mods
set -euo pipefail
cd "$(dirname "$0")"
python3 tools/modpack.py download --side client --dest "${1:-$HOME/.minecraft/mods}"
