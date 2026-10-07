#!/bin/bash
# alimenta o OBJETIVO (explorar) quando o explorador fica ocioso; nunca dá itens nem decide nada
. /tmp/run/lib.sh
LOG=/tmp/run/jauth/feeder.log
while true; do
  P "!bots"; sleep 2
  line=$(grep "explorador_01(" /tmp/run/chat.log | tail -1)
  if echo "$line" | grep -q "explorador_01(ocioso)"; then
    echo "$(date +%s) feed" >> $LOG; P "!explorar base 64"
  fi
  sleep 4
done
