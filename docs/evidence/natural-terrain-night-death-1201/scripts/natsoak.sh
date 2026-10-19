. /tmp/run/auto.sh
restart() { pgrep -f "[r]equire /tmp/run/lagmon.js" | xargs -r kill; sleep 3; (PREPRAD=8 setsid nohup /tmp/run/start.sh >/dev/null 2>&1 &); sleep 40; }
stock_nat() { local c="-14 72 -177"; C "setblock $c minecraft:chest"; sleep 0.5
 i=0; for it in "cobblestone 64" "oak_log 64" "coal 32" "iron_ingot 32" "cooked_beef 64" "iron_pickaxe 2" "iron_axe 2" "iron_sword 1" "stick 16" "crafting_table 1"; do C "item replace block $c container.$i with minecraft:${it% *} ${it#* }"; i=$((i+1)); done; sleep 1; }
reset2() {
  C "kill @e[type=!player]"; C "fill -13 72 -190 4 95 -168 air"; sleep 1
  C "fill -20 71 -186 -17 71 -176 stone"
  C "place feature minecraft:oak -9 72 -178"; C "place feature minecraft:oak -6 72 -184"; C "place feature minecraft:birch -10 72 -172"
  C "setblock -14 72 -182 minecraft:crafting_table"; stock_nat; sleep 2; }
restart
C list; sleep 1.5; tail -1 $SO/mcserver/server.log | grep -q explorador_01 || { P "!bot criar explorador 1"; sleep 25; }
P "!colonia auto off"; sleep 2
C "tp eduardo -14.5 72 -179.5"; C "tp eduardo_bot -13.5 72 -179.5"; sleep 2; reset2
C "clear explorador_01"; C "give explorador_01 stone_pickaxe 1"; C "give explorador_01 cooked_beef 8"; C "tp explorador_01 -14.5 72 -179.5"; sleep 3
P "!colonia necessidades"; sleep 6
N=$(xpn); echo $N > /tmp/run/ar.N; echo $(wc -l < /tmp/run/bot-current.log) > /tmp/run/long.L0; : > /tmp/run/soak.marks
P "!colonia auto on"
for r in 1 2 3 4 5 6 7 8; do
  sleep 40
  P "!colonia auto off"; sleep 15
  echo "round $r reset $(date +%s%3N)" >> /tmp/run/soak.marks
  reset2; C "clear explorador_01"; C "give explorador_01 stone_pickaxe 1"; C "give explorador_01 cooked_beef 8"
  C "tp explorador_01 -14.5 72 -179.5"; P "!colonia necessidades"; sleep 5; C "tp explorador_01 -14.5 72 -179.5"; sleep 1
  P "!colonia auto on"
  if [ $((r % 2)) = 0 ]; then sleep 2; echo "round $r zombie $(date +%s%3N)" >> /tmp/run/soak.marks; C "summon zombie -18.5 72 -176.5 {PersistenceRequired:1b}"; sleep 10; C "kill @e[type=zombie]"; fi
done
sleep 20; echo FIN > /tmp/run/soak.fin
