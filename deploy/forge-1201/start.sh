#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
# O lock dura enquanto o Java vive; não recriar FIFO de uma instância ativa.
exec 9>.server.lock
flock -n 9 || { echo 'Servidor já iniciado neste diretório' >&2; exit 1; }
if [[ -e console && ! -p console ]]; then
  echo 'console existe e não é FIFO; preserve o arquivo e escolha outro diretório' >&2
  exit 1
fi
[[ -p console ]] || mkfifo -m 600 console
exec 3<>console
exec "${JAVA_BIN:-/usr/bin/java}" @user_jvm_args.txt @libraries/net/minecraftforge/forge/1.20.1-47.4.10/unix_args.txt nogui <&3
