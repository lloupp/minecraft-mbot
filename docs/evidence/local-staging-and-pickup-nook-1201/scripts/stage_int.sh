. /tmp/run/auto.sh
# uso: stage_int.sh order|threat outfile
restart() { pgrep -f "[r]equire /tmp/run/lagmon.js" | xargs -r kill; sleep 3; (setsid nohup /tmp/run/start.sh >/dev/null 2>&1 &); sleep 40; }
restart
C list; sleep 1.5; tail -1 $SO/mcserver/server.log | grep -q explorador_01 || { P "!bot criar explorador 1"; sleep 25; }
P "!colonia auto off"; sleep 2; fixture2 317 313; stock
C "tp eduardo 321.5 200 -311.5"; C "tp eduardo_bot 319.5 200 -312.5"; C "tp explorador_01 310.5 200 -316.5"; sleep 3; P "!colonia necessidades"; sleep 6
C "tp explorador_01 310.5 200 -316.5"; sleep 1; N=$(xpn); echo $N > /tmp/run/ar.N; P "!colonia auto on"
for i in $(seq 1 600); do sleep 0.05; tail -n +$((N+1)) xp.jsonl | grep -q '"ev":"goTo".*"goal":\[317' && break; done
sleep 0.35; echo "ACTION $1 at $(date +%s%3N)" > $2
if [ "$1" = order ]; then P "!explorar base 8"; else C "summon zombie 314.5 200 -318.5 {PersistenceRequired:1b}"; fi
sleep 40; C "kill @e[type=zombie]"
autoshow $N >> $2; echo FIN >> $2
