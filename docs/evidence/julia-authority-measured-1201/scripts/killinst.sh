#!/bin/bash
# encerra tudo da instância $1 (sem casar o próprio shell)
I=$1; D=/tmp/run/m/srv-$I
for pat in "m/feed.s[h] $I" "m/pos.s[h] $I" "m/watch.s[h] $I" "mrun-$I-b[o]t" "mrun-$I-p[l]ayer" "holdfifo-$I"; do
  for p in $(pgrep -f "$pat"); do kill $p 2>/dev/null; done
done
if [ -f $D/server.pid ]; then SP=$(cat $D/server.pid); TP=$(pgrep -P $SP tail); kill $SP 2>/dev/null; [ -n "$TP" ] && kill $TP; fi
true
