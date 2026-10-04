. /tmp/run/lib.sh; . /tmp/run/layout.sh $1; export SO
for k in 1 2 3 4 5; do
 C "fill -26 72 -195 4 83 -150 air"; sleep 1; C "fill $STONE stone"
 IFS='|' read -ra TT <<< "$TREES"; for t in "${TT[@]}"; do C "place feature minecraft:$t"; done; sleep 3
 for t in "${TT[@]}"; do set -- $t; C "execute if block $2 73 $4 minecraft:${1}_log run say OK_$1_$2_$4"; done; sleep 2
 echo "iter $k: $(tail -12 $SO/mcserver/server.log | grep -c 'OK_') of ${#TT[@]}"
done
