restart() { pgrep -f "[r]equire /tmp/run/lagmon.js" | xargs -r kill; sleep 3; (setsid nohup /tmp/run/start.sh >/dev/null 2>&1 &); sleep 40; }
. /tmp/run/auto.sh
restart; C list; sleep 1.5; tail -1 $SO/mcserver/server.log | grep -q explorador_01 || { P "!bot criar explorador 1"; sleep 25; }
L0=$(wc -l < /tmp/run/bot-current.log); echo $L0 > /tmp/run/long.L0
bash /tmp/run/run_auto2.sh 240 317 313 /tmp/run/long.out
echo FIN >> /tmp/run/long.out
