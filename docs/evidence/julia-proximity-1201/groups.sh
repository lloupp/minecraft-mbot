#!/bin/bash
# Grupos controlados de fome (explorador_01): comida perto/longe x base perto/longe.
# Mesma unidade, inventário vazio, saúde 20, objetivo explore. Vaca NoAI a distância fixa.
. /tmp/run/lib.sh
W=explorador_01; PASSES=${PASSES:-2}; J=/tmp/run/journal-groups.log
NEAR_BASE="180.5 72 -89.5"; FAR_BASE="228.5 70 -90.5"
jr() { echo "$(date -u +%FT%TZ) $*" >> $J; }
food() { C "data get entity $W foodLevel"; sleep 0.7; tail -1 $SO/mcserver/server.log | grep -o "[0-9]*$"; }
visit() { # cell base_pos cow_offset
  local cell=$1 pos=$2 off=$3
  C "tp $W $pos"; sleep 0.7
  C "execute unless entity @e[tag=testcow] at $W run summon minecraft:cow ~$off ~ ~ {NoAI:1b,Silent:1b,Invulnerable:1b,PersistenceRequired:1b,Tags:[\"testcow\"]}"
  C "execute at $W run tp @e[tag=testcow,limit=1] ~$off ~ ~"; C "kill @e[type=item]"; sleep 0.5
  N=$(nrows); jr "DISPATCH cell=$cell"; P "!explorar base 8"; sleep 5
}
for pass in $(seq 1 $PASSES); do
  jr "PASS $pass start"
  C "kill @e[type=item]"; C "effect clear $W"; C "clear $W"; C "effect give $W minecraft:instant_health 1 10 true"; C "effect give $W minecraft:saturation 20 20 true"; sleep 22
  C "effect clear $W"; C "tp $W $NEAR_BASE"; sleep 2
  f=$(food); k=0
  while [ -n "$f" ] && [ "$f" -gt 8 ] && [ $k -lt 60 ]; do C "effect give $W minecraft:hunger 1 40 true"; sleep 1.2; f=$(food); k=$((k+1)); done
  C "effect give $W minecraft:hunger 1000 0 true"
  f=$(food)
  while [ -n "$f" ] && [ "$f" -ge 1 ]; do
    cells=(A B C D); for i in 3 2 1; do j=$((RANDOM % (i+1))); t=${cells[$i]}; cells[$i]=${cells[$j]}; cells[$j]=$t; done
    for c in "${cells[@]}"; do
      case $c in A) visit food_near_base_far "$FAR_BASE" 2;;      # G1
                 B) visit food_far_base_near "$NEAR_BASE" 6;;     # G2
                 C) visit food_near_base_near "$NEAR_BASE" 2;;    # G3
                 D) visit food_far_base_far "$FAR_BASE" 6;; esac  # controle extra
    done
    f=$(food)
  done
  C "effect clear $W"; C "effect give $W minecraft:saturation 20 20 true"; done
jr GROUPS_DONE
