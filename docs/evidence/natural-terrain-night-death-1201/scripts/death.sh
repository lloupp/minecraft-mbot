restart() { pgrep -f "[r]equire /tmp/run/lagmon.js" | xargs -r kill; sleep 3; (setsid nohup /tmp/run/start.sh >/dev/null 2>&1 &); sleep 40; }
. /tmp/run/auto.sh
restart
C list; sleep 1.5; tail -1 $SO/mcserver/server.log | grep -q explorador_01 || { P "!bot criar explorador 1"; sleep 25; }
P "!colonia auto off"; sleep 2; C "gamerule keepInventory false"; fixture2 317 313; stock
C "tp eduardo 321.5 200 -311.5"; C "tp eduardo_bot 319.5 200 -312.5"; C "tp explorador_01 310.5 200 -316.5"; sleep 3; P "!colonia necessidades"; sleep 6
N=$(xpn); echo $N > /tmp/run/ar.N
P "!colonia auto on"
for i in $(seq 1 400); do sleep 0.05; tail -n +$((N+1)) xp.jsonl | grep -q '"ev":"mineBlocks","w":"explorador_01","phase":"start"' && break; done
sleep 2.5; echo "kill $(date +%s%3N)" > /tmp/run/death.marks; C "kill explorador_01"
for i in 1 2 3 4 5 6 7 8; do sleep 20; C "data get entity explorador_01 Pos"; done
C "gamerule keepInventory true"; C list; echo FIN > /tmp/run/death.fin
