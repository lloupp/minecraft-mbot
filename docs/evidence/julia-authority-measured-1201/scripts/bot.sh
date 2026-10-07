#!/bin/bash
# bot da colônia no worktree da PR #88; braço julia ou controle (mesmo caminho/registro, escolha determinística)
. /tmp/run/m/common.sh $1; ARM=$2; OUT=$3
cd ${CODE:-/home/user/wt-meas}
export MINECRAFT_HOST=127.0.0.1 MINECRAFT_PORT=$PORT MINECRAFT_OWNER=eduardo MINECRAFT_PROFILE=vanilla1201 MINECRAFT_LAN_ANNOUNCE=0
export STATUS_SERVER=0 MBOT_VIEWER_PORT=0 MBOT_INVENTORY_PORT=0 MBOT_JULIA_SHADOW=0 MBOT_LAYA_SHADOW=0
export MBOT_JULIA_AUTHORITY=1 JULIA_PLAYER_LOOP_URL=http://127.0.0.1:8768/choose JULIA_AUTHORITY_TIMEOUT_MS=5000
[ "$ARM" = control ] && export MBOT_PLAYER_LOOP_CONTROL=1
export JULIA_AUTHORITY_LOG=$OUT/julia-authority.jsonl
export MBOT_EXPLORE_PREPARATION=1 MBOT_DETERMINISTIC_PREPARATION=1 MBOT_PREPARATION_RADIUS=8 MBOT_PREPARATION_BOOTSTRAP=1
export MBOT_WORLD_MEMORY=1 MBOT_WORLD_MEMORY_GUIDE=1 MBOT_WORLD_MEMORY_FILE=$OUT/world-memory.json
export COLONY_EVENT_LOG=$OUT/colony-events.jsonl COLONY_STATE_FILE=$OUT/colony-state.json COLONY_PROOF_FILE=$OUT/colony-proof.json
export MEMORY_FILE=$OUT/memory.json MBOT_TASK_CHECKPOINT_FILE=$OUT/checkpoint.json
[ -f $M/extra-env.sh ] && . $M/extra-env.sh
exec -a mrun-$I-bot node index.js >> $OUT/bot.log 2>&1 < /dev/null
