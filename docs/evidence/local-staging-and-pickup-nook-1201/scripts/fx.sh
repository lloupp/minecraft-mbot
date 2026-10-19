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
stock() { local c="318 200 -314"; C "setblock $c minecraft:chest"; sleep 0.5
i=0; for it in "cobblestone 64" "oak_log 64" "coal 32" "iron_ingot 32" "cooked_beef 64" "iron_pickaxe 2" "iron_axe 2" "iron_sword 1" "stick 16" "crafting_table 1"; do C "item replace block $c container.$i with minecraft:${it% *} ${it#* }"; i=$((i+1)); done; sleep 1; }
# fixture de staging: recursos <=4 do ponto inicial (310.5,-316.5); mesa a TX (5-8 blocos => staging; >8 => controle)
fixture2() { local TX=${1:-317} RX=${2:-313}; C "kill @e[type=!player]"; C "tp eduardo 330.5 200 -304.5"; C "clear eduardo"; C "tp explorador_01 310.5 200 -316.5"; sleep 1
C "fill 300 200 -330 332 206 -302 minecraft:air"; sleep 1
C "clear explorador_01"; C "give explorador_01 stone_pickaxe 1"; C "give explorador_01 cooked_beef 8"
C "setblock $TX 200 -317 minecraft:crafting_table"
for y in 200 201 202; do C "setblock $RX $y -318 minecraft:oak_log"; done
C "setblock $RX 200 -316 minecraft:stone"; C "setblock $RX 200 -317 minecraft:stone"; C "setblock $RX 201 -316 minecraft:stone"; sleep 3; }
