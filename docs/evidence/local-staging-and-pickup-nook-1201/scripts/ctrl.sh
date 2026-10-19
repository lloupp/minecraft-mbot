restart() { pgrep -f "[r]equire /tmp/run/lagmon.js" | xargs -r kill; sleep 3; (setsid nohup /tmp/run/start.sh >/dev/null 2>&1 &); sleep 40; }
restart; bash /tmp/run/run_auto2.sh 35 320 313 /tmp/run/ctrlA2.out
restart; bash /tmp/run/run_auto2.sh 35 317 308 /tmp/run/ctrlB2.out
