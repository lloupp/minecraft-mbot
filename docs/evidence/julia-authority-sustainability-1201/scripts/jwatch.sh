#!/bin/bash
# vigia de infraestrutura: só reergue processos mortos (registra cada vez); não toca no jogo
. /tmp/run/lib.sh
while true; do
  sleep 30
  if ! pgrep -f "[s]erver.jar nogui" >/dev/null || ! curl -s -m 3 localhost:8768/healthz >/dev/null || ! pgrep -f "[p]layer.cjs" >/dev/null; then
    echo "$(date +%s) infra_restart $(bash /tmp/run/jboot.sh)" >> /tmp/run/jauth/infra.log
  fi
  if ! pgrep -f "[j]ulia-run-marker" >/dev/null; then
    echo "$(date +%s) bot_restart" >> /tmp/run/jauth/infra.log
    (setsid nohup bash /tmp/run/start_julia.sh >/dev/null 2>&1 &); sleep 30
  fi
  pgrep -f "[j]feed.sh" >/dev/null || { echo "$(date +%s) feeder_restart" >> /tmp/run/jauth/infra.log; (setsid nohup bash /tmp/run/jfeed.sh >/dev/null 2>&1 &); }
done
