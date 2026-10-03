#!/bin/bash
. /tmp/claude-0/-home-user-minecraft-mbot/1eb6ea58-412c-4774-9c8f-6a979b59d5db/scratchpad/h/lib.sh; cd $H
rm -f pr3smoke.done pr3smoke.out events3.jsonl
stopbot; ps -eo pid,args | awk '/[n]ode index.js/{print $1}' | xargs -r kill -9
(setsid nohup node stubjulia.js > stub.out 2>&1 &)
echo "--- PR3 smoke" >> bot.log; rm -f bot.pid
REPO=/home/user/wt-pr3 WM=0 GUIDE=0 EXTRA="MBOT_JULIA_SHADOW=1 JULIA_PLAYER_LOOP_URL=http://127.0.0.1:8768/choose COLONY_EVENT_LOG=$H/events3.jsonl" startbot; sleep 40
C "fill 12 -60 -16 44 -40 16 air"; sleep 1; C "kill @e[type=item]"; for p in "20 -60 0" "27 -60 7" "31 -60 -5"; do C "place feature minecraft:oak $p"; sleep 0.5; done; sleep 2
C "tp lenhador_01 2.5 -60 2.5"; C "clear lenhador_01 oak_log"; sleep 2
L=$(wc -l < bot.log); P "!ordem lenhadores madeira 4"; waitdone $L 150 lenhador_01
tail -n +$((L+1)) bot.log | grep -E "^  ok:|gathered:" | head -2 >> pr3smoke.out
C "data get entity lenhador_01 Inventory"; sleep 1; tail -1 $MC/server.log | grep -o "oak_log\", Count: [0-9]*b" >> pr3smoke.out
sleep 8; echo "-- stub:" >> pr3smoke.out; cat stub.out >> pr3smoke.out
echo "-- julia_shadow_decision rows:" >> pr3smoke.out
python3 - >> pr3smoke.out <<'PY'
import json
H='/tmp/claude-0/-home-user-minecraft-mbot/1eb6ea58-412c-4774-9c8f-6a979b59d5db/scratchpad/h/events3.jsonl'
try:
    for l in open(H):
        d=json.loads(l)
        if d.get('type','').startswith('julia_shadow') or 'julia' in json.dumps(d)[:80]:
            r=d.get('data',d)
            print(json.dumps({k:r.get(k) for k in ['executedChoice','juliaChoice','candidates','executionAuthority','agreesWithRules','reason']}))
except Exception as e: print('erro',e)
PY
ps -eo pid,args | awk '/[s]tubjulia/{print $1}' | xargs -r kill
touch pr3smoke.done
