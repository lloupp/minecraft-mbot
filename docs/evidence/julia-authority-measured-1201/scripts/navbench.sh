#!/bin/bash
# uso: navbench.sh I CODE OUTDIR — mundo restaurado, servidor só para o benchmark
. /tmp/run/m/common.sh $1; CODEDIR=$2; OUT=$3; mkdir -p $OUT
bash $M/killinst.sh $I; sleep 2; cd $D
rm -rf world logs server.log; cp -a $M/pristine-world world
(setsid nohup ./run.sh >/dev/null 2>&1 & echo $! > $D/server.pid)
for i in $(seq 1 120); do sleep 2; grep -q "Done (" server.log 2>/dev/null && break; done
echo "head=$(git -C $CODEDIR rev-parse --short HEAD)" > $OUT/head.txt
CODE=$CODEDIR PORT=$PORT FIFO=$D/in.fifo OUT=$OUT/nav.jsonl node $M/navbench.js > $OUT/stdout.txt 2>&1
bash $M/killinst.sh $I
python3 - $OUT/nav.jsonl <<'PY'
import json,sys
rows=[json.loads(l) for l in open(sys.argv[1])]
for k in ('explore','return'):
    r=[x for x in rows if x['kind']==k]
    print(k, 'ok', sum(x['ok'] for x in r), 'de', len(r), 'tempo_medio_s', round(sum(x['ms'] for x in r)/max(1,len(r))/1000,1))
PY
