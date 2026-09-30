#!/bin/bash
. /tmp/run/lib.sh
J=/tmp/run/journal-ctx.log; jr() { echo "$(date -u +%FT%TZ) $*" >> $J; }
EX=306; EZ=-317; MX=322; MZ=-317
clear_area() { C "fill $(($1-8)) 199 $(($2-8)) $(($1+8)) 203 $(($2+8)) minecraft:air replace minecraft:oak_log"; C "fill $(($1-8)) 199 $(($2-8)) $(($1+8)) 203 $(($2+8)) minecraft:air replace minecraft:stone"; C "fill $(($1-8)) 199 $(($2-8)) $(($1+8)) 203 $(($2+8)) minecraft:air replace minecraft:iron_ore"; C "fill $(($1-8)) 199 $(($2-8)) $(($1+8)) 199 $(($2+8)) minecraft:dirt"; }
put() { local bx=$1 bz=$2 kind=$3 dx=$4 dy=$5 dz=$6; C "setblock $((bx+dx)) $((200+dy)) $((bz+dz)) minecraft:$kind"; }
run_one() { local w=$1 grp=$2 cmd=$3; shift 3
  if [ "$w" = explorador_01 ]; then bx=$EX; bz=$EZ; else bx=$MX; bz=$MZ; fi
  clear_area $bx $bz; C "clear $w"
  [ "$w" = minerador_01 ] && C "give $w stone_pickaxe 1"
  C "effect give $w minecraft:saturation 5 20 true"
  while [ $# -gt 0 ]; do put $bx $bz "$1" $2 $3 $4; shift 4; done
  C "tp $w $bx.5 200 $((bz+1)).5"; sleep 3
  local R0=$(grep -c '"type":"result"' $PD); jr "DISPATCH group=$grp worker=$w cmd=$cmd"; P "$cmd"
  for i in $(seq 1 40); do [ "$(grep -c '"type":"result"' $PD)" -gt "$R0" ] && break; sleep 1; done; sleep 1
}
EXP="!explorar plat 4"; MIN="!ordem minerador iron_ore 1"
# G1 explore madeira+pedra ~2
run_one explorador_01 G1 "$EXP" oak_log 2 0 0 stone 0 0 2
run_one explorador_01 G1 "$EXP" oak_log 0 0 2 stone 2 0 0
run_one explorador_01 G1 "$EXP" oak_log -2 0 0 stone 0 0 -2
run_one explorador_01 G1 "$EXP" oak_log 0 0 -2 stone -2 0 0
run_one explorador_01 G1 "$EXP" oak_log 2 0 0 stone 0 0 -2
run_one explorador_01 G1 "$EXP" oak_log -2 0 0 stone 0 0 2
# G2 explore ~5.7
run_one explorador_01 G2 "$EXP" oak_log 4 0 4 stone 4 0 -4
run_one explorador_01 G2 "$EXP" oak_log -4 0 4 stone 4 0 4
run_one explorador_01 G2 "$EXP" oak_log 4 0 -4 stone -4 0 -4
run_one explorador_01 G2 "$EXP" oak_log -4 0 -4 stone -4 0 4
run_one explorador_01 G2 "$EXP" oak_log 4 0 4 stone -4 0 4
run_one explorador_01 G2 "$EXP" oak_log -4 0 -4 stone 4 0 -4
# G3 explore so madeira
for v in "oak_log 2 0 0" "oak_log 0 0 2" "oak_log 2 0 2" "oak_log -2 1 0" "oak_log 4 0 0" "oak_log 0 0 -4"; do run_one explorador_01 G3 "$EXP" $v; done
# G4 mine_iron recursos proximos
run_one minerador_01 G4 "$MIN" oak_log 0 0 2 stone 2 0 0 iron_ore -2 0 0
run_one minerador_01 G4 "$MIN" oak_log 0 0 -2 stone -2 0 0 iron_ore 2 0 0
run_one minerador_01 G4 "$MIN" oak_log 2 0 0 stone 0 0 2 iron_ore 0 0 -2
run_one minerador_01 G4 "$MIN" oak_log 4 0 0 stone 0 0 4 iron_ore -4 0 0
run_one minerador_01 G4 "$MIN" oak_log -2 0 0 stone 0 0 -4 iron_ore 2 0 2
run_one minerador_01 G4 "$MIN" oak_log 0 0 -4 stone 4 0 0 iron_ore -2 0 0
jr DONE
