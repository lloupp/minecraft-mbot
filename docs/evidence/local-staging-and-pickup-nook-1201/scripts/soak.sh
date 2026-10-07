restart() { pgrep -f "[r]equire /tmp/run/lagmon.js" | xargs -r kill; sleep 3; (setsid nohup /tmp/run/start.sh >/dev/null 2>&1 &); sleep 40; }
. /tmp/run/auto.sh
restart
C list; sleep 1.5; tail -1 $SO/mcserver/server.log | grep -q explorador_01 || { P "!bot criar explorador 1"; sleep 25; }
P "!bot remover explorador_02"; sleep 4
P "!colonia auto off"; sleep 2; fixture2 317 313; stock
C "tp eduardo 321.5 200 -311.5"; C "tp eduardo_bot 319.5 200 -312.5"; sleep 3; P "!colonia necessidades"; sleep 6
N=$(xpn); echo $N > /tmp/run/ar.N; echo $(wc -l < /tmp/run/bot-current.log) > /tmp/run/long.L0
: > /tmp/run/soak.marks
P "!colonia auto on"
for r in 1 2 3 4 5 6 7 8; do
  sleep 40
  P "!colonia auto off"; sleep 15
  echo "round $r reset $(date +%s%3N)" >> /tmp/run/soak.marks
  C "kill @e[type=zombie]"
  C "clear explorador_01"; C "give explorador_01 stone_pickaxe 1"; C "give explorador_01 cooked_beef 8"
  C "setblock 317 200 -317 minecraft:crafting_table"
  for y in 200 201 202; do C "setblock 313 $y -318 minecraft:oak_log"; done
  C "setblock 313 200 -316 minecraft:stone"; C "setblock 313 200 -317 minecraft:stone"; C "setblock 313 201 -316 minecraft:stone"
  C "tp explorador_01 310.5 200 -316.5"; P "!colonia necessidades"; sleep 5; C "tp explorador_01 310.5 200 -316.5"; sleep 1
  P "!colonia auto on"
  if [ $((r % 2)) = 0 ]; then sleep 2; echo "round $r zombie $(date +%s%3N)" >> /tmp/run/soak.marks; C "summon zombie 308.5 200 -318.5 {PersistenceRequired:1b}"; sleep 10; C "kill @e[type=zombie]"; fi
done
sleep 20; echo FIN > /tmp/run/soak.fin
