#!/bin/bash
. /tmp/claude-0/-home-user-minecraft-mbot/1eb6ea58-412c-4774-9c8f-6a979b59d5db/scratchpad/h/lib.sh; cd $H
rm -f p2.done
for i in 1 2 3; do
  C "tp lenhador_01 2.5 -60 2.5"; C "clear lenhador_01 oak_log"; sleep 2
  L=$(wc -l < bot.log); echo "== ORDEM $i"; P "!ordem lenhadores madeira 2"; waitdone $L 120 lenhador_01 || echo "(sem término em 120s)"
  sleep 2; tail -n +$((L+1)) bot.log | grep "world-memory\|terminou\|falhou em\|code:" | cut -c1-230
done
touch p2.done
