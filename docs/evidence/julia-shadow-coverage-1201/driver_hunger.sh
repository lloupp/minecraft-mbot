#!/bin/bash
# Segmento de fome: sem saturação; desce o nível com pulsos de Hunger e despacha com vaca por perto.
. /tmp/run/lib.sh
BOTLOG=/tmp/run/bot-current.log; J=/tmp/run/journal-hunger.log
CYCLES=${CYCLES:-24}
jr() { echo "$(date -u +%FT%TZ) $*" >> $J; }
ended() { grep -c "\] $1 \(terminou\|falhou\|erro\)" $BOTLOG; }
food() { C "data get entity $1 foodLevel"; sleep 0.7; tail -1 $SO/mcserver/server.log | grep -o "[0-9]*$"; }
zombie_clean() { C "execute at $1 run kill @e[type=cow,distance=..48]"; }
i=0
while [ $i -lt $CYCLES ]; do i=$((i+1))
  case $((i % 3)) in 0) W=explorador_01; X=168; Z=-88; CMD="!explorar base 8"; KIT="stick 2|cobblestone 3";;
                     1) W=lenhador_01; X=150; Z=-105; CMD="!ordem lenhador oak_log 1"; KIT="wooden_axe 1|crafting_table 1";;
                     2) W=minerador_01; X=200; Z=-100; CMD="!ordem minerador iron_ore 1"; KIT="wooden_pickaxe 1|crafting_table 1";; esac
  T=$(( (RANDOM % 5) * 2 + 2 ))   # alvo de food: 2,4,6,8,10
  C "effect clear $W"; C "spreadplayers $X $Z 1 7 false $W"; sleep 2
  C "clear $W"; IFS='|' read -ra items <<< "$KIT"; for it in "${items[@]}"; do C "give $W $it"; done
  C "effect give $W minecraft:instant_health 1 10 true"; C "effect give $W minecraft:saturation 1 0 true"; sleep 2
  f=$(food $W); k=0
  while [ -n "$f" ] && [ "$f" -gt "$T" ] && [ $k -lt 60 ]; do C "effect give $W minecraft:hunger 1 40 true"; sleep 1.2; f=$(food $W); k=$((k+1)); done
  C "execute at $W run summon minecraft:cow ~3 ~ ~"; sleep 1; f=$(food $W)
  N=$(ended $W); jr "DISPATCH hunger W=$W target=$T food=$f :: $CMD"; P "$CMD"
  for s in $(seq 1 90); do [ "$(ended $W)" -gt "$N" ] && break; sleep 1; done
  C "effect clear $W"; C "effect give $W minecraft:saturation 20 20 true"; zombie_clean $W; sleep 2
done
echo HUNGER_DONE >> $J
