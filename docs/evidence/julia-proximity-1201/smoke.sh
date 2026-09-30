#!/bin/bash
# Smoke curto (ameaça c/ e s/ arma, exploração, gather_materials, interrupção/retomada). Só chat/console de teste.
. /tmp/run/lib.sh
BOTLOG=/tmp/run/bot-current.log; J=/tmp/run/journal-smoke.log; ROUNDS=${ROUNDS:-10}
jr() { echo "$(date -u +%FT%TZ) $*" >> $J; }
ended() { grep -c "\] $1 \(terminou\|falhou\|erro\)" $BOTLOG; }
waitend() { local w=$1 t=$2 n0=$3; for i in $(seq 1 $t); do [ "$(ended $w)" -gt "$n0" ] && return 0; sleep 1; done; return 1; }
zone() { C "spreadplayers $2 $3 1 7 false $1"; sleep 2; }
kit() { local w=$1; shift; C "clear $w"; for it in "$@"; do C "give $w $it"; done; C "effect give $w minecraft:instant_health 1 10 true"; C "effect give $w minecraft:saturation 20 10 true"; sleep 1; }
zombie() { C "execute at $1 run summon minecraft:zombie ~${2:-10} ~ ~ {ArmorItems:[{},{},{},{id:\"minecraft:leather_helmet\",Count:1b}],PersistenceRequired:1b}"; sleep 1; }
cleanup() { for w in "$@"; do C "execute at $w run kill @e[type=zombie,distance=..48]"; done; C "kill @e[type=item]"; }
dw() { local ws=$1 cmd=$2 t=$3 label=$4; declare -A n0; for w in $ws; do n0[$w]=$(ended $w); done; jr "DISPATCH $label"; P "$cmd"; for w in $ws; do waitend $w $t ${n0[$w]} || jr "TIMEOUT_WAIT $w $label"; done; }
E=explorador_01; A=lenhador_01; B=lenhador_02
for r in $(seq 1 $ROUNDS); do jr "ROUND $r"
  zone $E 168 -88; kit $E "stick 2" "cobblestone 3"; dw $E "!explorar base 8" 60 "exploration"
  zone $E 168 -88; kit $E; C "execute at $E run setblock ~2 ~ ~2 minecraft:iron_ore"; dw $E "!explorar base 8" 60 "gather_materials(iron near, no weapon)"; C "execute positioned 168 75 -88 run fill ~-15 ~-15 ~-15 ~15 ~15 ~15 minecraft:air replace minecraft:iron_ore"
  zone $E 168 -88; kit $E "stick 2" "cobblestone 3"; zombie $E 12; dw $E "!explorar base 8" 60 "threat_noweapon"; cleanup $E
  zone $A 150 -105; zone $B 150 -105; for w in $A $B; do kit $w "wooden_axe 1" "crafting_table 1" "stone_sword 1"; done; zombie $A 10; zombie $B 10; dw "$A $B" "!ordem lenhador oak_log 2" 60 "threat_weapon"; cleanup $A $B
  zone $A 150 -105; zone $B 150 -105; for w in $A $B; do kit $w "stone_sword 1" "wooden_axe 1" "crafting_table 1"; done; zombie $A 12; zombie $B 12
  n0a=$(ended $A); jr "DISPATCH interrupt_resume"; P "!ordem lenhador oak_log 40"; sleep 7; zombie $A 12; zombie $B 12; P "!ordem lenhador oak_log 40"; sleep 20; P "!ordem lenhador oak_log 2"; waitend $A 50 $n0a; cleanup $A $B
done
echo SMOKE_DONE >> $J
