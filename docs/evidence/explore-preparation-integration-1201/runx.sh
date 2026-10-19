. /tmp/run/fx.sh
runx() { fixture; N=$(xpn); P "$1"; for i in $(seq 1 ${2:-60}); do sleep 1; tail -n +$((N+1)) /tmp/run/xp.jsonl | grep -q '"run.end"' && break; done
python3 - $N <<'PY'
import json,sys
n=int(sys.argv[1]); rows=[json.loads(l) for l in open('/tmp/run/xp.jsonl')][n:]
t0=rows[0]['t'] if rows else 0
for r in rows:
    if r['ev'] in('prep.start','prep.end','run.end','explore.start','xpl.end') or (r['ev']=='mineBlocks' and r.get('phase')=='attempt'):
        t=r.pop('t')-t0; print(t, json.dumps(r)[:240])
PY
}
