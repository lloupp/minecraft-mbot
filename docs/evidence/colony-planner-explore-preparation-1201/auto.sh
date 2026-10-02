. /tmp/run/fx.sh
# uso: autorun <segundos> [notable]  -> monta fixture (sem mesa se NOTABLE=1), refresca estoque, liga auto e observa
autorun() { P "!colonia auto off"; sleep 2; fixture; [ "$NOTABLE" = 1 ] && C "setblock 311 200 -318 minecraft:air"; stock
  C "tp eduardo 321.5 200 -311.5"; C "tp eduardo_bot 319.5 200 -312.5"; sleep 3; P "!colonia necessidades"; sleep 8
  N=$(xpn); P "!colonia auto on"; sleep $1; }
autoshow() { python3 - $1 <<'PY'
import json,sys
n=int(sys.argv[1]); rows=[json.loads(l) for l in open('/tmp/run/xp.jsonl')][n:]
t0=rows[0]['t'] if rows else 0
for r in rows:
    if r['ev'] in ('collectDrops','mineBlocks','explore.pos+2000','explore.pos+6000','planner.plan','xpl.start','prep.start','prep.end'): continue
    t=(r.pop('t')-t0)/1000; print(round(t,1), json.dumps(r)[:200])
PY
}
