#!/bin/bash
# Uma execução medida: mundo restaurado do snapshot, explorador do zero, sem itens, sem intervenção.
# uso: run1.sh I ARM MINUTOS OUT
. /tmp/run/m/common.sh $1; ARM=$2; MIN=$3; OUT=$4
mkdir -p $OUT; cd $D
stop_all() {
  for pat in "m/feed.s[h] $I" "m/pos.s[h] $I" "m/watch.s[h] $I" "mrun-$I-b[o]t" "mrun-$I-p[l]ayer" "holdfifo-$I"; do
    for p in $(pgrep -f "$pat"); do kill $p 2>/dev/null; done
  done
  if [ -f $D/server.pid ] && kill -0 $(cat $D/server.pid) 2>/dev/null; then
    SP=$(cat $D/server.pid); TP=$(pgrep -P $SP tail)
    C "stop"; for i in $(seq 1 40); do sleep 1; kill -0 $(cat $D/server.pid) 2>/dev/null || break; done
    kill $(cat $D/server.pid) 2>/dev/null
    [ -n "$TP" ] && kill $TP 2>/dev/null
  fi
}
stop_all; sleep 1
rm -rf $D/world $D/logs $D/server.log $CHAT; cp -a $M/pristine-world $D/world
echo "$(date +%s) start arm=$ARM inst=$I head=$(git -C ${CODE:-/home/user/wt-meas} rev-parse --short HEAD) dirty=$(git -C ${CODE:-/home/user/wt-meas} status --porcelain | grep -c '^ M')" >> $OUT/infra.log
git -C ${CODE:-/home/user/wt-meas} diff > $OUT/code.diff
(setsid nohup ./run.sh >/dev/null 2>&1 & echo $! > $D/server.pid)
for i in $(seq 1 120); do sleep 2; grep -q "Done (" server.log 2>/dev/null && break; done
[ -p $FIFO ] || mkfifo $FIFO
(setsid nohup bash -c "exec -a holdfifo-$I tail -f /dev/null > $FIFO" >/dev/null 2>&1 &)
(PORT=$PORT FIFO=$FIFO CHAT=$CHAT setsid nohup bash -c "exec -a mrun-$I-player node $M/player.cjs" >/dev/null 2>&1 &)
sleep 8; C "gamemode creative eduardo"; C "tp eduardo 240 64 -110"
(setsid nohup bash $M/bot.sh $I $ARM $OUT >/dev/null 2>&1 &); sleep 30
C "tp eduardo_bot 241 64 -110"; sleep 4; P "!base aqui"; sleep 3
C "gamemode spectator eduardo"; C "tp eduardo 240 110 -110"; C "gamemode spectator eduardo_bot"; C "tp eduardo_bot 250 110 -100"
P "!bot criar explorador 1"; sleep 15
C "time set 0"; C "weather clear"
echo "$(date +%s) explorer_created" >> $OUT/infra.log
(setsid nohup bash $M/feed.sh $I $OUT >/dev/null 2>&1 &); (setsid nohup bash $M/pos.sh $I $OUT >/dev/null 2>&1 &); (setsid nohup bash $M/watch.sh $I $ARM $OUT >/dev/null 2>&1 &)
sleep $((MIN*60))
echo "$(date +%s) end" >> $OUT/infra.log
stop_all
cp $D/server.log $OUT/server.log; cp $CHAT $OUT/chat.log 2>/dev/null
gzip -f $OUT/bot.log $OUT/server.log
echo done $OUT
