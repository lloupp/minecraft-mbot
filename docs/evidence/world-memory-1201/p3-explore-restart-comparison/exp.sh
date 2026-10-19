#!/bin/bash
# exp.sh <worker> <n>: n execuções de !explorar base 64 aguardando o término de cada uma
. /tmp/claude-0/-home-user-minecraft-mbot/1eb6ea58-412c-4774-9c8f-6a979b59d5db/scratchpad/h/lib.sh; cd $H
W=$1; N=$2; rm -f exp.done
for ((k=0;k<N;k++)); do L=$(wc -l < bot.log); P "!explorar base 64"; waitdone $L 90 $W || echo timeout; done
touch exp.done
