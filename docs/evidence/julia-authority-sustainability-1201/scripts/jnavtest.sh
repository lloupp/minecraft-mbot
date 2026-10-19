#!/bin/bash
. /tmp/run/lib.sh
OUT=$1; MIN=${2:-15}; mkdir -p $OUT
for p in $(pgrep -f "jfeed.s[h]") $(pgrep -f "jwatch.s[h]") $(pgrep -f "jpos.s[h]") $(pgrep -f "julia-run-marke[r]"); do kill $p; done; sleep 4
rm -rf /tmp/run/jauth; mkdir -p /tmp/run/jauth
rm -f $SO/mcserver/world/playerdata/3ec58ac7-127d-398c-8a38-bcefd2d313f9.dat*
C "kill @e[type=item]"; C "time set 1000"; C "weather clear"
bash /tmp/run/jstart_fresh.sh > $OUT/start.txt 2>&1
sleep $(( MIN * 60 ))
for p in $(pgrep -f "jfeed.s[h]") $(pgrep -f "jwatch.s[h]") $(pgrep -f "jpos.s[h]") $(pgrep -f "julia-run-marke[r]"); do kill $p; done
cp /tmp/run/jauth/* $OUT/ 2>/dev/null; echo DONE > $OUT/done
