. /tmp/run/auto.sh
restart() { pgrep -f "[r]equire /tmp/run/lagmon.js" | xargs -r kill; sleep 3; (setsid nohup /tmp/run/start.sh >/dev/null 2>&1 &); sleep 40; }
reset_camp() {
  C "kill @e[type=!player]"; C "fill 90 70 -162 114 95 -140 air"; sleep 1
  C "fill 103 66 -151 105 66 -149 stone"; C "fill 103 67 -151 105 69 -149 air"
  C "place feature minecraft:oak 96 70 -147"; C "place feature minecraft:oak 95 70 -153"; C "place feature minecraft:birch 105 70 -146"; C "place feature minecraft:oak 108 70 -152"
  C "setblock 102 70 -154 minecraft:crafting_table"; C "setblock 101 70 -156 minecraft:chest"; sleep 3; }
restart
C list; sleep 1.5; tail -1 $SO/mcserver/server.log | grep -q explorador_01 || { P "!bot criar explorador 1"; sleep 25; }
P "!colonia auto off"; sleep 2
: > /tmp/run/natural.out
i=0
for pos in "100.5 70 -150.5" "98.5 70 -149.5" "103.5 70 -153.5" "97.5 70 -155.5" "102.5 70 -147.5" "106.5 70 -150.5"; do
  i=$((i+1)); reset_camp
  C "clear explorador_01"; C "give explorador_01 stone_pickaxe 1"; C "give explorador_01 cooked_beef 8"
  C "tp explorador_01 $pos"; sleep 3
  N=$(xpn); P "!explorar base 8"
  for t in $(seq 1 70); do sleep 1; tail -n +$((N+1)) /tmp/run/xp.jsonl | grep -q '"ev":"run.end"\|"ev":"run.reject"' && break; done
  echo "=== start $i ($pos)" >> /tmp/run/natural.out
  python3 - $N >> /tmp/run/natural.out <<'PY'
import json,sys
n=int(sys.argv[1]); rows=[json.loads(l) for l in open('/tmp/run/xp.jsonl')][n:]
t0=rows[0]['t'] if rows else 0
for r in rows:
    if r['ev'] in ('staging.start','staging.end','table.search','xpl.end','run.reject') or (r['ev']=='mineBlocks' and r.get('phase')=='attempt'):
        k={x:v for x,v in r.items() if x not in('t','inv','w','nav','invNow')}
        print(round((r['t']-t0)/1000,1), json.dumps(k)[:230])
PY
done
echo FIN >> /tmp/run/natural.out
