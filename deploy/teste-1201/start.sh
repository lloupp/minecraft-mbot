#!/bin/sh
# Servidor de TESTE. Comandos do console: echo "<comando>" > console
cd "$(dirname "$0")"
rm -f console && mkfifo console
# Mantém o FIFO aberto para leitura e escrita: o console nunca recebe fim de arquivo.
exec 3<>console
exec /usr/bin/java -Xms512M -Xmx1G -jar server.jar nogui <&3
