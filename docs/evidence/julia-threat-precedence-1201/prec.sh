#!/bin/bash
# Guardrail de fome crítica: células (zona da base x distância da comida) sob queda de food 8->0.
. /tmp/run/lib.sh
W=explorador_01; PASSES=${PASSES:-8}; J=/tmp/run/journal-prec.log
FAR="228.5 70 -90.5"; NEAR="180.5 72 -89.5"; ATB="173.5 76 -88"
jr() { echo "$(date -u +%FT%TZ) $*" >> $J; }
food() { C "data get entity $W foodLevel"; sleep 0.7; tail -1 $SO/mcserver/server.log | grep -o "[0-9]*$"; }
visit() { # cell zonepos cowoffset [zombie]
  local cell=$1 pos=$2 off=$3 z=$4
  C "tp $W $pos"; sleep 0.7
  C "execute unless entity @e[tag=testcow] at $W run summon minecraft:cow ~$off ~ ~ {NoAI:1b,Silent:1b,Invulnerable:1b,PersistenceRequired:1b,Tags:[\"testcow\"]}"
  C "execute at $W run tp @e[tag=testcow,limit=1] ~$off ~ ~"; C "kill @e[type=item]"
  [ -n "$z" ] && C "execute at $W run summon minecraft:zombie ~-9 ~ ~ {ArmorItems:[{},{},{},{id:\"minecraft:leather_helmet\",Count:1b}],PersistenceRequired:1b}"
  sleep 0.5; jr "DISPATCH cell=$cell"; P "!explorar base 8"; sleep 5
  [ -n "$z" ] && C "execute at $W run kill @e[type=zombie,distance=..60]"
}
for pass in $(seq 1 $PASSES); do
  jr "PASS $pass start"
  C "kill @e[type=item]"; C "effect clear $W"; C "clear $W"; C "effect give $W minecraft:instant_health 1 10 true"; C "effect give $W minecraft:saturation 20 20 true"; sleep 22
  C "effect clear $W"; C "tp $W $NEAR"; sleep 2
  f=$(food); k=0
  while [ -n "$f" ] && [ "$f" -gt 8 ] && [ $k -lt 60 ]; do C "effect give $W minecraft:hunger 1 40 true"; sleep 1.2; f=$(food); k=$((k+1)); done
  C "effect give $W minecraft:hunger 1000 0 true"; f=$(food)
  while [ -n "$f" ] && [ "$f" -ge 1 ]; do
    cells=(${CELLS:-A B C D E F G X}); n=${#cells[@]}; for i in $(seq $((n-1)) -1 1); do j=$((RANDOM % (i+1))); t=${cells[$i]}; cells[$i]=${cells[$j]}; cells[$j]=$t; done
    for c in "${cells[@]}"; do
      case $c in A) visit far_cow2 "$FAR" 2;;
                 B) visit near_cow2 "$NEAR" 2;;
                 C) visit near_cow7.5 "$NEAR" 7.5;;
                 D) visit atbase_cow7 "$ATB" 7;;
                 H) visit atbase_cow6.5 "$ATB" 6.5;;
                 I) visit atbase_cow7.8 "$ATB" 7.8;;
                 E) visit far_cow9.5 "$FAR" 9.5;;
                 F) visit near_cow8.5 "$NEAR" 8.5;;
                 G) visit far_cow6 "$FAR" 6;;
                 X) visit near_cow2_zombie "$NEAR" 2 z;; Y) C "give $W minecraft:stone_sword 1"; visit near_cow2_zombie_sword "$NEAR" 2 z; C "clear $W minecraft:stone_sword";; Z) visit near_cow7.5_zombie "$NEAR" 7.5 z;; esac
      f=$(food); [ -n "$f" ] && [ "$f" -lt 1 ] && break
    done
    f=$(food)
  done
  C "effect clear $W"; C "effect give $W minecraft:saturation 20 20 true"
done
jr GUARD_DONE
