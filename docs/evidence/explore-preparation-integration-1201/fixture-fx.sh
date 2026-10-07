. /tmp/run/lib.sh
fixture() { C "kill @e[type=!player]"; C "tp eduardo 330.5 200 -304.5"; C "clear eduardo"; C "tp explorador_01 310.5 200 -316.5"; sleep 1
C "fill 300 200 -330 332 206 -302 minecraft:air"; sleep 1
C "clear explorador_01"; C "give explorador_01 stone_pickaxe 1"; C "give explorador_01 cooked_beef 8"
C "setblock 311 200 -318 minecraft:crafting_table"
for y in 200 201 202; do C "setblock 310 $y -313 minecraft:oak_log"; done
C "setblock 313 200 -316 minecraft:stone"; C "setblock 313 200 -317 minecraft:stone"; C "setblock 313 201 -316 minecraft:stone"; sleep 3; }
xpn() { [ -f /tmp/run/xp.jsonl ] && wc -l < /tmp/run/xp.jsonl || echo 0; }
xps() { tail -n +$(($1+1)) /tmp/run/xp.jsonl | python3 -c "
import sys,json
for l in sys.stdin:
    r=json.loads(l); t=r.pop('t'); print(t%1000000, json.dumps(r))" | cut -c1-330; }
