#!/bin/bash
. /tmp/claude-0/-home-user-minecraft-mbot/1eb6ea58-412c-4774-9c8f-6a979b59d5db/scratchpad/h/lib.sh; cd $H
rm -f expsmoke.done expsmoke.out wm.json
stopbot; ps -eo pid,args | awk '/[n]ode index.js/{print $1}' | xargs -r kill -9
C "fill 12 -60 -16 44 -40 16 air"; bigfill 70 -60 -30 125 -45 30; sleep 2; C "kill @e[type=item]"
for p in "86 -60 -6" "92 -60 4" "98 -60 -2"; do C "place feature minecraft:oak $p"; sleep 0.5; done
C "give explorador_01 iron_sword 1"; C "give lenhador_01 iron_axe 1"; C "clear lenhador_01 oak_log"
echo "--- EXP SMOKE fase1" >> bot.log; rm -f bot.pid
REPO=/home/user/wt-exp WM=1 GUIDE=1 startbot; sleep 40
C "tp eduardo 92.5 -60 0.5"; sleep 2; P "!local salvar floresta2"; sleep 3; C "tp eduardo 0.5 -60 0.5"; C "tp explorador_01 92.5 -60 0.5"; sleep 3
L=$(wc -l < bot.log); P "!explorar floresta2 32"; waitdone $L 90 explorador_01
echo "fase1: $(grep -c 'discover wood' bot.log) discover wood" >> expsmoke.out
sleep 4; stopbot; ps -eo pid,args | awk '/[n]ode index.js/{print $1}' | xargs -r kill -9
cp wm.json wm.expsmoke.before-restart.json
echo "--- EXP SMOKE fase2 (restart)" >> bot.log; rm -f bot.pid
REPO=/home/user/wt-exp WM=1 GUIDE=1 startbot; sleep 40
C "tp lenhador_01 2.5 -60 2.5"; C "clear lenhador_01 oak_log"; sleep 2
L=$(wc -l < bot.log); P "!ordem lenhadores madeira 3"; waitdone $L 150 lenhador_01
tail -n +$((L+1)) bot.log | grep -E "world-memory|^  ok:|gathered:" >> expsmoke.out
C "data get entity lenhador_01 Inventory"; sleep 1; tail -1 $MC/server.log | grep -o "oak_log\", Count: [0-9]*b" >> expsmoke.out
stopbot; ps -eo pid,args | awk '/[n]ode index.js/{print $1}' | xargs -r kill -9
touch expsmoke.done
