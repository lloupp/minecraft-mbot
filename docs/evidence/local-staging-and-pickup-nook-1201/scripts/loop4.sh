restart() { pgrep -f "[r]equire /tmp/run/lagmon.js" | xargs -r kill; sleep 3; (setsid nohup /tmp/run/start.sh >/dev/null 2>&1 &); sleep 40; }
. /tmp/run/auto.sh
: > /tmp/run/loop4.out
for r in 1 2 3 4; do restart
  C list; sleep 1.5; tail -1 $SO/mcserver/server.log | grep -q explorador_01 || { P "!bot criar explorador 1"; sleep 25; }
  bash /tmp/run/run_auto2.sh 30 317 313 /tmp/run/l4.tmp
  echo "=== run $r" >> /tmp/run/loop4.out; python3 /tmp/run/summ.py >> /tmp/run/loop4.out 2>&1; cp /tmp/run/l4.tmp /tmp/run/l4_$r.out
done; echo FIN >> /tmp/run/loop4.out
