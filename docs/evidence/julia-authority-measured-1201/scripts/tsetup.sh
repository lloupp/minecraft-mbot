#!/bin/bash
# Prepara um teste dirigido: mundo restaurado, servidor, dono, bot (CODE/ARM), base no spawn e um explorador.
# uso: tsetup.sh I ARM OUT   (CODE no ambiente). Deixa tudo rodando; encerrar com killinst.sh I.
. /tmp/run/m/common.sh $1; ARM=$2; OUT=$3; mkdir -p $OUT; cd $D
[ "$ARM" = julia ] && bash $M/sidecar.sh >/dev/null
bash $M/killinst.sh $I; sleep 2
rm -rf world logs server.log $CHAT; cp -a $M/pristine-world world
echo "$(date +%s) start arm=$ARM inst=$I head=$(git -C ${CODE:-/home/user/wt-meas} rev-parse --short HEAD)" >> $OUT/infra.log
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
echo "$(date +%s) explorer_created" >> $OUT/infra.log
grep -c "explorador_01 joined" $D/server.log
