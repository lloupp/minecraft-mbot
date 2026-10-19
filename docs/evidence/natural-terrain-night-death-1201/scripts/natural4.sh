. /tmp/run/auto.sh
restart() { pgrep -f "[r]equire /tmp/run/lagmon.js" | xargs -r kill; sleep 3; (PREPRAD=$1 setsid nohup /tmp/run/start.sh >/dev/null 2>&1 &); sleep 40; }
reset2() {
  C "kill @e[type=!player]"; C "fill -13 72 -190 4 95 -168 air"; sleep 1
  C "fill -20 71 -186 -17 71 -176 stone"
  C "place feature minecraft:oak -9 72 -178"; C "place feature minecraft:oak -6 72 -184"; C "place feature minecraft:birch -10 72 -172"
  C "setblock -14 72 -182 minecraft:crafting_table"; C "setblock -14 72 -177 minecraft:chest"; sleep 3; }
setup() {
  P "!colonia auto off"; sleep 2
  C "tp eduardo -14.5 72 -179.5"; C "tp eduardo_bot -13.5 72 -179.5"; C "tp explorador_01 -14.5 72 -179.5"; sleep 3
  reset2; P "!base aqui"; sleep 3; P "!estoque aqui"; sleep 3; tail -2 /tmp/run/chat.log | cut -c1-150; }
run_round() { # $1 label
  reset2; C "clear explorador_01"; C "give explorador_01 stone_pickaxe 1"; C "give explorador_01 cooked_beef 8"
  C "tp explorador_01 -14.5 72 -179.5"; sleep 3
  N=$(xpn); P "!explorar base 8"
  for t in $(seq 1 75); do sleep 1; tail -n +$((N+1)) /tmp/run/xp.jsonl | grep -q '"ev":"run.end"\|"ev":"run.reject"' && break; done
  echo "=== $1" >> /tmp/run/natural2.out
  python3 - $N >> /tmp/run/natural2.out <<'PY'
import json,sys
n=int(sys.argv[1]); rows=[json.loads(l) for l in open('/tmp/run/xp.jsonl')][n:]
t0=rows[0]['t'] if rows else 0
for r in rows:
    if r['ev'] in ('staging.start','xpl.end','run.reject','prep.end','goTo') or (r['ev']=='mineBlocks' and r.get('phase')=='attempt'):
        k={x:v for x,v in r.items() if x not in('t','inv','w','nav','invNow','v')}
        print(round((r['t']-t0)/1000,1), json.dumps(k)[:210])
PY
}
restart 8
C list; sleep 1.5; tail -1 $SO/mcserver/server.log | grep -q explorador_01 || { P "!bot criar explorador 1"; sleep 25; }
setup
: > /tmp/run/natural2.out
for i in 1 2 3 4 5 6 7 8; do run_round "r8-$i"; done
echo FIN >> /tmp/run/natural2.out
