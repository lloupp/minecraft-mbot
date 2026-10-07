#!/bin/bash
# Campanha retomável: pares (Julia x controle em paralelo, instâncias alternadas) e depois o benchmark de navegação.
# Execução já concluída (infra.log com 'end') é pulada; incompleta é movida para *-interrompido-<epoch>.
# uso: campaign.sh TAG CODE MINUTOS PARES
TAG=$1; export CODE=$2; MIN=$3; N=$4; R=/tmp/run/m/runs
if ! curl -s -m 3 localhost:8768/healthz >/dev/null; then
  (cd /home/user/wt-exp && JULIA_MODEL=/tmp/julia-src JULIA_PORT=8768 HF_HUB_OFFLINE=1 setsid nohup /tmp/julia-venv/bin/python scripts/julia-decision-server.py >> /tmp/run/julia.log 2>&1 &)
  for i in $(seq 1 60); do sleep 3; curl -s -m 2 localhost:8768/healthz >/dev/null && break; done
fi
curl -s -m 30 -X POST localhost:8768/choose -H 'content-type: application/json' -d '{"state":{"health":20},"candidates":[{"id":"a","description":"x"},{"id":"b","description":"y"}]}' > /dev/null
done_run() { grep -q " end$" $R/$1/infra.log 2>/dev/null; }
for k in $(seq 1 $N); do
  if [ $((k % 2)) = 1 ]; then AA=julia; BB=control; else AA=control; BB=julia; fi
  done_run $TAG-$AA-$k && done_run $TAG-$BB-$k && continue
  for x in $TAG-$AA-$k $TAG-$BB-$k; do [ -d $R/$x ] && mv $R/$x $R/$x-interrompido-$(date +%s); done
  bash /tmp/run/m/run1.sh A $AA $MIN $R/$TAG-$AA-$k > $R/$TAG-$AA-$k.out 2>&1 &
  bash /tmp/run/m/run1.sh B $BB $MIN $R/$TAG-$BB-$k > $R/$TAG-$BB-$k.out 2>&1 &
  wait
  echo "$(date -u +%H:%M) par $k ok" >> $R/$TAG-campaign.log
done
[ -f $R/$TAG-nav/nav.jsonl ] && [ $(wc -l < $R/$TAG-nav/nav.jsonl) -ge 26 ] || { rm -rf $R/$TAG-nav; bash /tmp/run/m/navbench.sh A $CODE $R/$TAG-nav >> $R/$TAG-campaign.log 2>&1; }
echo "$(date -u +%H:%M) fim" >> $R/$TAG-campaign.log
