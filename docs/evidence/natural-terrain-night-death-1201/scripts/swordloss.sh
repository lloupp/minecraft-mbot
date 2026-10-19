restart() { pgrep -f "[r]equire /tmp/run/lagmon.js" | xargs -r kill; sleep 3; (setsid nohup /tmp/run/start.sh >/dev/null 2>&1 &); sleep 40; }
. /tmp/run/auto.sh
restart
C list; sleep 1.5; tail -1 $SO/mcserver/server.log | grep -q explorador_01 || { P "!bot criar explorador 1"; sleep 25; }
P "!colonia auto off"; sleep 2; fixture2 317 313; stock
C "tp eduardo 321.5 200 -311.5"; C "tp eduardo_bot 319.5 200 -312.5"; C "tp explorador_01 310.5 200 -316.5"; sleep 3; P "!colonia necessidades"; sleep 6
N=$(xpn); echo $N > /tmp/run/ar.N; echo $(wc -l < /tmp/run/bot-current.log) > /tmp/run/long.L0; : > /tmp/run/sl.marks
P "!colonia auto on"; sleep 45
for r in 1 2 3; do
  echo "round $r sword_removed $(date +%s%3N)" >> /tmp/run/sl.marks
  C "clear explorador_01 minecraft:stone_sword"
  C "setblock 317 200 -317 minecraft:crafting_table"
  for y in 200 201 202; do C "setblock 313 $y -318 minecraft:oak_log"; done
  C "setblock 313 200 -316 minecraft:stone"; C "setblock 313 200 -317 minecraft:stone"; C "setblock 313 201 -316 minecraft:stone"
  C "tp explorador_01 310.5 200 -316.5"
  sleep 55
done
echo FIN > /tmp/run/sl.fin
