#!/bin/bash
# bot da colônia a partir da PR #88 (worktree), com autoridade Julia
cd /home/user/wt-exp; . /tmp/run/env.sh
export MBOT_JULIA_SHADOW=0 MBOT_LAYA_SHADOW=0
export MBOT_JULIA_AUTHORITY=1 JULIA_PLAYER_LOOP_URL=http://127.0.0.1:8768/choose JULIA_AUTHORITY_TIMEOUT_MS=5000
export JULIA_AUTHORITY_LOG=/tmp/run/jauth/julia-authority.jsonl
export MBOT_EXPLORE_PREPARATION=1 MBOT_DETERMINISTIC_PREPARATION=1 MBOT_PREPARATION_RADIUS=8 MBOT_PREPARATION_BOOTSTRAP=${BOOTSTRAP:-1}
export MBOT_WORLD_MEMORY=1 MBOT_WORLD_MEMORY_GUIDE=1 MBOT_WORLD_MEMORY_FILE=/tmp/run/jauth/world-memory.json
export COLONY_EVENT_LOG=/tmp/run/jauth/colony-events.jsonl COLONY_STATE_FILE=/tmp/run/jauth/colony-state.json COLONY_PROOF_FILE=/tmp/run/jauth/colony-proof.json
export MEMORY_FILE=/tmp/run/jauth/memory.json MBOT_TASK_CHECKPOINT_FILE=/tmp/run/jauth/checkpoint.json
exec -a julia-run-marker node index.js >> /tmp/run/jauth/bot.log 2>&1 < /dev/null
