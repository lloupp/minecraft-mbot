#!/bin/bash
cd /tmp/claude-0/-home-user-minecraft-mbot/1eb6ea58-412c-4774-9c8f-6a979b59d5db/scratchpad/h
rm -f both.done
./expcmp.sh 0 off; rm -f expcmp.done
./expcmp.sh 1 on
touch both.done
