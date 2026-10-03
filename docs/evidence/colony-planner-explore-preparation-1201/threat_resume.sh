. /tmp/run/auto.sh
P "!colonia auto off"; sleep 2; fixture; stock; C "tp eduardo 321.5 200 -311.5"; C "tp eduardo_bot 319.5 200 -312.5"; sleep 3; P "!colonia necessidades"; sleep 8
N=$(xpn); echo $N > /tmp/run/tr.N; P "!colonia auto on"
for i in $(seq 1 60); do sleep 0.25; tail -n +$((N+1)) xp.jsonl | grep -q '"ev":"mineBlocks","phase":"start"' && break; done; sleep 1.5
C "summon zombie 316.5 200 -319.5 {PersistenceRequired:1b}"; sleep 12; C "kill @e[type=zombie]"; sleep 45
autoshow $N > /tmp/run/tr.out; echo FIN >> /tmp/run/tr.out
