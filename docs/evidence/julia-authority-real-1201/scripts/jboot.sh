#!/bin/bash
# idempotente: sobe servidor, sidecar Julia e o jogador "eduardo" se não estiverem de pé
. /tmp/run/lib.sh
if ! pgrep -f "[s]erver.jar nogui" >/dev/null; then
  (cd $SO/mcserver && setsid nohup ./run.sh >/dev/null 2>&1 &)
  for i in $(seq 1 60); do sleep 2; tail -2 $SO/mcserver/server.log | grep -q "Done (" && break; done
fi
if ! curl -s -m 2 localhost:8768/healthz >/dev/null; then
  (cd /home/user/wt-exp && JULIA_MODEL=/tmp/julia-src JULIA_PORT=8768 HF_HUB_OFFLINE=1 setsid nohup /tmp/julia-venv/bin/python scripts/julia-decision-server.py >> /tmp/run/julia.log 2>&1 &)
  for i in $(seq 1 60); do sleep 3; curl -s -m 2 localhost:8768/healthz >/dev/null && break; done
fi
if ! pgrep -f "[p]layer.cjs" >/dev/null; then
  [ -p /tmp/run/player.fifo ] || mkfifo /tmp/run/player.fifo
  (setsid nohup bash /tmp/run/startplayer.sh > /tmp/run/player.out 2>&1 &); sleep 8
fi
echo "server=$(pgrep -fc '[s]erver.jar nogui') julia=$(curl -s -m 2 localhost:8768/healthz >/dev/null && echo up || echo down) player=$(pgrep -fc '[p]layer.cjs') bot=$(pgrep -fc '[j]ulia-run-marker')"
