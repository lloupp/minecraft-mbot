#!/bin/bash
. /tmp/run/lib.sh; source <(sed -n '/^J=/,/^EXP=/p' /tmp/run/gather_groups.sh | sed '$d'); J=/tmp/run/journal-g45.log
EXP="!explorar plat 4"
VAR=("oak_log 2 0 0" "oak_log 0 0 2" "oak_log 2 0 2" "oak_log -2 1 0" "oak_log 4 0 0" "oak_log 0 0 -4")
phase() { local g=$1; for v in "${VAR[@]}"; do run_one explorador_01 $g "$EXP" $v; done; }
# base longe: base na floresta
C "tp eduardo 171 76 -88"; C "tp eduardo_bot 171 76 -88"; sleep 8; P "!base aqui"; sleep 3; jr "BASE_FAR $(grep base /tmp/run/chat.log | tail -1 | cut -c1-90)"
phase G4
# base perto: base na plataforma
C "tp eduardo 314.5 200 -316.5"; C "tp eduardo_bot 314.5 200 -316.5"; sleep 8; P "!base aqui"; sleep 3; jr "BASE_NEAR $(grep base /tmp/run/chat.log | tail -1 | cut -c1-90)"
phase G5
jr G45_DONE
