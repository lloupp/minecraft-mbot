#!/bin/bash
# amostra posição, vida/fome e hora do mundo a cada ~5 s
. /tmp/run/m/common.sh $1; OUT=$2
while true; do
  C "data get entity explorador_01 Pos"; C "time query daytime"; sleep 1
  p=$(grep "explorador_01 has the following entity data: \[" $D/server.log | tail -1 | grep -o "\[.*\]")
  t=$(grep "The time is" $D/server.log | tail -1 | grep -o "[0-9]*$")
  echo "$(date +%s) $t $p" >> $OUT/positions.log
  sleep 4
done
