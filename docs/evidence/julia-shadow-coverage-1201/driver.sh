#!/bin/bash
# Driver da sessão real (não faz parte do produto): 3 laços paralelos (explorador, lenhadores, mineradores).
# Cada ciclo: reposiciona, entrega as ferramentas do papel, monta a condição, despacha UMA ordem manual
# via chat do dono e espera a tarefa terminar. Nunca dá autoridade à Julia; só chat/console de teste.
. /tmp/run/lib.sh
BOTLOG=/tmp/run/bot-current.log
START=$(date +%s); MIN_SECS=${MIN_SECS:-7500}; MIN_ROWS=${MIN_ROWS:-520}; MAX_SECS=${MAX_SECS:-13000}
J=/tmp/run/journal.log
jr() { echo "$(date -u +%FT%TZ) $*" >> $J; }
active_secs() { python3 - <<'PY'
import json
t=[]
for l in open('/tmp/run/julia-shadow.jsonl'):
    try: t.append(json.loads(l)['decidedAt'])
    except Exception: pass
from datetime import datetime
ts=sorted(datetime.fromisoformat(x.replace('Z','+00:00')).timestamp() for x in t)
print(int(sum(b-a for a,b in zip(ts,ts[1:]) if b-a<=600)))
PY
}
alive() { local e=$(( $(date +%s) - START )); [ -f /tmp/run/STOP ] && return 1
  [ $e -ge $MAX_SECS ] && return 1; { [ $(active_secs) -lt $MIN_SECS ] || [ $(nrows) -lt $MIN_ROWS ]; }; }
ended() { grep -c "\] $1 \(terminou\|falhou\|erro\)" $BOTLOG; }
waitend() { local w=$1 t=$2 n0=$3; for i in $(seq 1 $t); do [ "$(ended $w)" -gt "$n0" ] && return 0; sleep 1; done; return 1; }
zone() { C "spreadplayers $2 $3 1 7 false $1"; sleep 2; }
kit() { local w=$1; shift; C "clear $w"; for it in "$@"; do C "give $w $it"; done; C "effect give $w minecraft:instant_health 1 10 true"; C "effect give $w minecraft:saturation 3 10 true"; sleep 1; }
zombie() { C "execute at $1 run summon minecraft:zombie ~${2:-10} ~ ~ {ArmorItems:[{},{},{},{id:\"minecraft:leather_helmet\",Count:1b}],PersistenceRequired:1b}"; sleep 1; }
cleanup() { for w in "$@"; do C "execute at $w run kill @e[type=zombie,distance=..48]"; C "execute at $w run kill @e[type=cow,distance=..48]"; done; }
rmore() { C "execute positioned $1 75 $2 run fill ~-15 ~-15 ~-15 ~15 ~15 ~15 minecraft:air replace $3"; }
PICK=('nothing' 'iron' 'stone' 'wood_only')

dispatch_wait() { # worker(s-space-separated) cmd timeout label
  local ws=$1 cmd=$2 t=$3 label=$4; declare -A n0
  for w in $ws; do n0[$w]=$(ended $w); done
  jr "DISPATCH $label :: $cmd"; P "$cmd"
  for w in $ws; do waitend $w $t ${n0[$w]} || jr "TIMEOUT_WAIT $w $label"; done
}

loop_explorer() { local W=explorador_01 X=168 Z=-88 k=0
  while alive; do k=$((k+1)); zone $W $X $Z
    case $((k % 7)) in
    0) kit $W "stick 2" "cobblestone 3"; dispatch_wait $W "!explorar base 8" 110 "E prep_combat";;
    1) kit $W; C "execute at $W run setblock ~2 ~ ~2 minecraft:iron_ore"; dispatch_wait $W "!explorar base 8" 110 "E iron_near_noweapon"; rmore $X $Z minecraft:iron_ore;;
    2) kit $W "stone_sword 1"; zombie $W 10; dispatch_wait $W "!explorar base 8" 110 "E threat_weapon"; cleanup $W;;
    3) kit $W "stick 2" "cobblestone 3"; zombie $W 12; dispatch_wait $W "!explorar base 8" 110 "E threat_noweapon_craftable"; cleanup $W;;
    4) kit $W; C "execute at $W run summon minecraft:cow ~3 ~ ~"; C "effect give $W minecraft:hunger 25 12 true"; sleep 14
       dispatch_wait $W "!explorar base 8" 110 "E hunger_cow"; C "effect clear $W"; C "effect give $W minecraft:saturation 20 20 true"; cleanup $W;;
    5) kit $W "stick 2" "cobblestone 3"; C "time set midnight"; dispatch_wait $W "!explorar base 8" 110 "E night_prep"; C "time set day";;
    6) kit $W "stick 2" "cobblestone 3"; for r in 1 2 3; do dispatch_wait $W "!explorar base 8" 110 "E repeated_identical_$r"; done;;
    esac; done; }

loop_wood() { local A=lenhador_01 B=lenhador_02 X=150 Z=-105 k=0
  while alive; do k=$((k+1)); zone $A $X $Z; zone $B $X $Z
    for w in $A $B; do kit $w "wooden_axe 1" "crafting_table 1"; done
    case $((k % 4)) in
    0) dispatch_wait "$A $B" "!ordem lenhador oak_log 2" 90 "L gather_oak";;
    1) for w in $A $B; do kit $w "wooden_axe 1" "crafting_table 1" "stone_sword 1"; done; zombie $A 10; zombie $B 10; dispatch_wait "$A $B" "!ordem lenhador oak_log 2" 90 "L threat_weapon"; cleanup $A $B;;
    2) for w in $A $B; do kit $w "stone_sword 1" "wooden_axe 1" "crafting_table 1"; done; zombie $A 12; zombie $B 12
       n0a=$(ended $A); jr "DISPATCH L interrupt_resume :: !ordem lenhador oak_log 40"; P "!ordem lenhador oak_log 40"; sleep 7; zombie $A 12; zombie $B 12
       P "!ordem lenhador oak_log 40"; sleep 25; P "!ordem lenhador oak_log 2"; waitend $A 60 $n0a; cleanup $A $B;;
    3) C "execute at $A run summon minecraft:cow ~3 ~ ~"; C "execute at $B run summon minecraft:cow ~3 ~ ~"; for w in $A $B; do C "effect give $w minecraft:hunger 25 12 true"; done; sleep 14
       dispatch_wait "$A $B" "!ordem lenhador oak_log 2" 90 "L hunger_cow"; for w in $A $B; do C "effect clear $w"; C "effect give $w minecraft:saturation 20 20 true"; done; cleanup $A $B;;
    esac; done; }

loop_mine() { local A=minerador_01 B=minerador_02 X=200 Z=-100 k=0
  while alive; do k=$((k+1)); zone $A $X $Z; zone $B $X $Z
    for w in $A $B; do kit $w "wooden_pickaxe 1" "crafting_table 1"; done
    case $((k % 4)) in
    0) C "execute at $A run setblock ~2 ~ ~2 minecraft:iron_ore"; dispatch_wait "$A $B" "!ordem minerador iron_ore 2" 90 "M iron_near_noweapon"; rmore $X $Z minecraft:iron_ore;;
    1) for w in $A $B; do kit $w "wooden_pickaxe 1" "crafting_table 1" "stick 2" "cobblestone 3"; done; dispatch_wait "$A $B" "!ordem minerador iron_ore 2" 90 "M prep_combat";;
    2) for w in $A $B; do kit $w "wooden_pickaxe 1" "crafting_table 1"; done; zombie $A 10; zombie $B 10; dispatch_wait "$A $B" "!ordem minerador iron_ore 2" 90 "M threat_noweapon"; cleanup $A $B;;
    3) for w in $A $B; do kit $w "stone_sword 1" "wooden_pickaxe 1" "crafting_table 1"; done; zombie $A 10; zombie $B 10; dispatch_wait "$A $B" "!ordem minerador iron_ore 2" 90 "M threat_weapon"; cleanup $A $B;;
    esac; done; }

sampler() { while alive; do
  echo "$(date -u +%FT%TZ) julia_rss_mb=$(ps -eo rss,args | awk '/[j]ulia-decision/ {print int($1/1024)}') node_rss_mb=$(ps -eo rss,args | awk '/[l]agmon.js/ {print int($1/1024)}') server_rss_mb=$(ps -eo rss,args | awk '/[s]erver.jar/ {print int($1/1024)}') rows=$(nrows) lagmax=$(python3 -c "import json;print(json.load(open('/tmp/run/lag-max.json'))['max_ms'])" 2>/dev/null)" >> /tmp/run/rss.log; sleep 60; done; }

jr "SESSION_START"; sampler & loop_explorer & loop_wood & loop_mine & wait
jr "SESSION_END rows=$(nrows)"; echo DRIVER_DONE >> /tmp/run/journal.log
