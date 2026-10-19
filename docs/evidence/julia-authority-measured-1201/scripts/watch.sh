#!/bin/bash
# vigia de infraestrutura da instância: só reergue processos mortos, registrando
. /tmp/run/m/common.sh $1; ARM=$2; OUT=$3
while true; do
  sleep 30
  if [ "$ARM" = julia ] && ! curl -s -m 3 localhost:8768/healthz >/dev/null; then
    echo "$(date +%s) julia_sidecar_restart" >> $OUT/infra.log
    bash $M/sidecar.sh >/dev/null
  fi
  if ! pgrep -f "mrun-$I-b[o]t" >/dev/null; then echo "$(date +%s) bot_restart" >> $OUT/infra.log; (setsid nohup bash $M/bot.sh $I $ARM $OUT >/dev/null 2>&1 &); sleep 30; fi
  if ! pgrep -f "mrun-$I-p[l]ayer" >/dev/null; then echo "$(date +%s) player_restart" >> $OUT/infra.log; (cd $M; PORT=$PORT FIFO=$FIFO CHAT=$CHAT setsid nohup bash -c "exec -a mrun-$I-player node $M/player.cjs" >/dev/null 2>&1 &); sleep 8; fi
done
