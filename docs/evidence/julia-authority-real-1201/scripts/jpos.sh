#!/bin/bash
. /tmp/run/lib.sh
while true; do
  C "data get entity explorador_01 Pos"; sleep 1
  p=$(grep "explorador_01 has the following entity data: \[" $SO/mcserver/server.log | tail -1 | grep -o "\[.*\]")
  echo "$(date -u +%H:%M:%S) $p" >> /tmp/run/jauth/positions.log
  sleep 4
done
