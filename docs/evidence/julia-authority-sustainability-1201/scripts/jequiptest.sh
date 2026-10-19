#!/bin/bash
. /tmp/run/lib.sh
OUT=$1; mkdir -p $OUT
for p in $(pgrep -f "jfeed.s[h]") $(pgrep -f "jwatch.s[h]") $(pgrep -f "jpos.s[h]") $(pgrep -f "julia-run-marke[r]"); do kill $p; done; sleep 4
rm -rf /tmp/run/jauth; mkdir -p /tmp/run/jauth
rm -f $SO/mcserver/world/playerdata/3ec58ac7-127d-398c-8a38-bcefd2d313f9.dat*
C "kill @e[type=item]"; C "time set 6000"; C "weather clear"
bash /tmp/run/jstart_fresh.sh > $OUT/start.txt 2>&1
for p in $(pgrep -f "jpos.s[h]") $(pgrep -f "jfeed.s[h]"); do kill $p; done
for i in 1 2 3; do
  C "kill @e[type=zombie]"; C "clear explorador_01"; C "give explorador_01 stone_sword 1"; C "give explorador_01 dirt 1"; sleep 2
  C "execute at explorador_01 run summon zombie ~9 ~ ~ {PersistenceRequired:1b}"; sleep 1
  P "!explorar base 64"; sleep 25
  C "data get entity explorador_01 SelectedItem"; sleep 1
done
C "kill @e[type=zombie]"
for p in $(pgrep -f "jwatch.s[h]") $(pgrep -f "julia-run-marke[r]"); do kill $p; done
cp /tmp/run/jauth/* $OUT/ 2>/dev/null; grep "SelectedItem\|explorador_01 has the following entity data" $SO/mcserver/server.log | tail -3 > $OUT/held.txt; echo DONE > $OUT/done
