# uso: natmulti.sh <LAYOUT> <NEXPL> <ROUNDS>
. /tmp/run/auto.sh; . /tmp/run/layout.sh $1; NEXPL=${2:-1}; ROUNDS=${3:-6}
restart() { ps -eo pid,args | grep "[r]equire /tmp/run/lagmon.js" | awk '{print $1}' | xargs -r kill; sleep 3; (PREPRAD=8 setsid nohup /tmp/run/start.sh >/dev/null 2>&1 &); sleep 40; }
stock_at() { local c="$1"; C "setblock $c minecraft:chest"; sleep 0.5
 i=0; for it in "cobblestone 64" "oak_log 64" "coal 32" "iron_ingot 32" "cooked_beef 64" "iron_pickaxe 2" "iron_axe 2" "iron_sword 1" "stick 16" "crafting_table 1"; do C "item replace block $c container.$i with minecraft:${it% *} ${it#* }"; i=$((i+1)); done; sleep 1; }
reset_layout() {
  C "kill @e[type=!player]"; C "fill -26 72 -195 4 83 -150 air"; C "fill -26 84 -195 4 95 -150 air"; C "fill -26 69 -195 4 71 -150 stone replace air"; sleep 1
  C "fill $STONE stone"
  IFS='|' read -ra TT <<< "$TREES"; for t in "${TT[@]}"; do C "place feature minecraft:$t"; done
  C "setblock $TABLE minecraft:crafting_table"; stock_at "$CHEST"; sleep 2; }
restart
for n in $(seq 1 $NEXPL); do
  C list; sleep 1.5; tail -1 $SO/mcserver/server.log | grep -q "explorador_0$n" || { P "!bot criar explorador 1"; sleep 25; }
done
P "!colonia auto off"; sleep 2
C "tp eduardo $START"; C "tp eduardo_bot $START"; sleep 2; reset_layout
P "!base aqui"; sleep 3; P "!estoque aqui"; sleep 3; C "tp eduardo -13 72 -125"; C "tp eduardo_bot -15 72 -125"; sleep 1; tail -2 /tmp/run/chat.log | cut -c1-140
give_all() { for n in $(seq 1 $NEXPL); do w=explorador_0$n; C "clear $w"; C "give $w stone_pickaxe 1"; C "give $w cooked_beef 8"; C "tp $w $START"; done; }
reset_layout; give_all; sleep 3; P "!colonia necessidades"; sleep 6
N=$(xpn); echo $N > /tmp/run/ar.N; : > /tmp/run/soak.marks
P "!colonia auto on"
for r in $(seq 1 $ROUNDS); do
  sleep 40
  P "!colonia auto off"; sleep 15
  echo "round $r reset $(date +%s%3N)" >> /tmp/run/soak.marks
  reset_layout; give_all; P "!colonia necessidades"; sleep 5; give_all; sleep 1
  P "!colonia auto on"
  if [ $((r % 2)) = 0 ]; then sleep 2; echo "round $r zombie $(date +%s%3N)" >> /tmp/run/soak.marks; C "summon zombie -18.5 72 -176.5 {PersistenceRequired:1b}"; sleep 10; C "kill @e[type=zombie]"; fi
done
sleep 20; echo FIN > /tmp/run/multi.fin
