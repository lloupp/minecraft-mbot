#!/bin/bash
# expcmp.sh <guide 0|1> <tag>: memória nova; fase1 (6 explorações) -> restart real -> fase2 (6 explorações)
. /tmp/claude-0/-home-user-minecraft-mbot/1eb6ea58-412c-4774-9c8f-6a979b59d5db/scratchpad/h/lib.sh; cd $H
G=$1; TAG=$2; rm -f expcmp.done
stopbot; rm -f wm.json; C "tp explorador_01 0.5 -60 0.5"; echo "--- EXPCMP $TAG guide=$G fase1" >> bot.log
GUIDE=$G startbot; sleep 40
./exp.sh explorador_01 6
python3 -c "import json;print('fase1',json.load(open('wm.json'))['metrics'])" >> expcmp.$TAG.out 2>&1
stopbot; C "tp explorador_01 0.5 -60 0.5"; echo "--- EXPCMP $TAG guide=$G fase2 (restart)" >> bot.log
GUIDE=$G startbot; sleep 40
./exp.sh explorador_01 6
sleep 3; stopbot
python3 -c "import json;d=json.load(open('wm.json'));print('fase2',d['metrics'],'chunks',len(d['explored']))" >> expcmp.$TAG.out 2>&1
cp wm.json wm.$TAG.json; cp bot.log bot.$TAG.log
touch expcmp.done
