restart() { pgrep -f "[r]equire /tmp/run/lagmon.js" | xargs -r kill; sleep 3; (setsid nohup /tmp/run/start.sh >/dev/null 2>&1 &); sleep 40; }
. /tmp/run/auto.sh
restart
for i in 1 2; do C list; sleep 1.5; tail -1 $SO/mcserver/server.log | grep -q explorador_01 || { P "!bot criar explorador 1"; sleep 25; }; done
C list; sleep 1.5; tail -1 $SO/mcserver/server.log | grep -q explorador_02 || { P "!bot criar explorador 1"; sleep 25; }
P "!colonia auto off"; sleep 2; fixture2 317 313; stock
for w in explorador_01 explorador_02; do C "clear $w"; C "give $w stone_pickaxe 1"; C "give $w cooked_beef 8"; done
C "tp eduardo 321.5 200 -311.5"; C "tp eduardo_bot 319.5 200 -312.5"; C "tp explorador_01 310.5 200 -316.5"; C "tp explorador_02 311.5 200 -316.5"; sleep 3; P "!colonia necessidades"; sleep 6
C "tp explorador_01 310.5 200 -316.5"; C "tp explorador_02 311.5 200 -316.5"; sleep 1
N=$(xpn); echo $N > /tmp/run/ar.N; L0=$(wc -l < /tmp/run/bot-current.log); echo $L0 > /tmp/run/long.L0; P "!colonia auto on"; sleep ${1:-90}
C list; echo FIN > /tmp/run/two.fin
