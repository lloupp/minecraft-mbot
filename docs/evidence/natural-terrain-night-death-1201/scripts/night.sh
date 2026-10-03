. /tmp/run/auto.sh
restart() { pgrep -f "[r]equire /tmp/run/lagmon.js" | xargs -r kill; sleep 3; (setsid nohup /tmp/run/start.sh >/dev/null 2>&1 &); sleep 40; }
restart
C list; sleep 1.5; tail -1 $SO/mcserver/server.log | grep -q explorador_01 || { P "!bot criar explorador 1"; sleep 25; }
P "!colonia auto off"; sleep 2; fixture2 317 313; stock
# explorador desarmado SEM recursos por perto (longe da mesa/árvores), longe da base
C "setblock 317 200 -317 minecraft:air"; for y in 200 201 202; do C "setblock 313 $y -318 minecraft:air"; done; C "fill 313 200 -317 313 201 -316 minecraft:air"
C "tp eduardo 321.5 200 -311.5"; C "tp eduardo_bot 319.5 200 -312.5"; C "tp explorador_01 345.5 200 -330.5"; sleep 3; P "!colonia necessidades"; sleep 6
N=$(xpn); echo $N > /tmp/run/ar.N
C "time set 14500"; sleep 1
echo "night_on $(date +%s%3N)" > /tmp/run/night.marks
P "!colonia auto on"; sleep 50
echo "day_on $(date +%s%3N)" >> /tmp/run/night.marks
C "time set 1000"; sleep 35
echo FIN > /tmp/run/night.fin
