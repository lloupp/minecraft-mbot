#!/bin/bash
# objetivo: reemite "!explorar base 64" quando o explorador fica ocioso (igual a um jogador); nunca dá itens nem escolhe
. /tmp/run/m/common.sh $1; OUT=$2
while true; do
  P "!bots"; sleep 2
  line=$(grep "explorador_01(" $CHAT | tail -1)
  if echo "$line" | grep -q "explorador_01(ocioso)"; then echo "$(date +%s) feed" >> $OUT/feeder.log; P "!explorar base 64"; fi
  sleep 4
done
