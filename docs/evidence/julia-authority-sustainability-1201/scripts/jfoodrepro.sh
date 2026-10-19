#!/bin/bash
# reprodução de comida: explorador recém-nascido na base, fome drenada por efeito (sem itens), 10 min com a Julia no comando
. /tmp/run/lib.sh
OUT=$1; mkdir -p $OUT
for p in $(pgrep -f "jfeed.s[h]") $(pgrep -f "jwatch.s[h]") $(pgrep -f "julia-run-marke[r]"); do kill $p; done; sleep 4
rm -rf /tmp/run/jauth; mkdir -p /tmp/run/jauth
rm -f $SO/mcserver/world/playerdata/3ec58ac7-127d-398c-8a38-bcefd2d313f9.dat*
C "kill @e[type=item]"; C "time set ${TIME:-1000}"; C "weather clear"
bash /tmp/run/jstart_fresh.sh > $OUT/start.txt 2>&1
for p in $(pgrep -f "jpos.s[h]"); do kill $p; done
C "effect give explorador_01 hunger 40 120 true"; sleep 45
T=$(( $(date +%s) + 600 ))
while [ $(date +%s) -lt $T ]; do C "data get entity explorador_01 foodLevel"; sleep 15; done
for p in $(pgrep -f "jfeed.s[h]") $(pgrep -f "jwatch.s[h]") $(pgrep -f "julia-run-marke[r]"); do kill $p; done
cp /tmp/run/jauth/* $OUT/ 2>/dev/null
grep -o "explorador_01 has the following entity data: [0-9]*" $SO/mcserver/server.log | tail -45 | awk '{print $NF}' | paste -sd' ' > $OUT/food_series.txt
echo DONE > $OUT/done
