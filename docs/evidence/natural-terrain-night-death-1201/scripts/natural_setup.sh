. /tmp/run/lib.sh
P "!colonia auto off"; sleep 2
C "forceload add 40 -230 170 -70"; sleep 3
C "tp eduardo 99.5 70 -153.5"; C "tp eduardo_bot 100.5 70 -154.5"; C "tp explorador_01 100.5 70 -150.5"; sleep 3
C "setblock 101 70 -156 minecraft:chest"
# árvores naturais (feature do servidor) e pedreira cavada até a pedra natural
C "place feature minecraft:oak 96 70 -147"; C "place feature minecraft:oak 95 70 -153"; C "place feature minecraft:birch 105 70 -146"; C "place feature minecraft:oak 108 70 -152"
C "fill 103 67 -151 105 69 -149 air"
C "setblock 102 70 -154 minecraft:crafting_table"
sleep 4
P "!base aqui"; sleep 3; P "!estoque aqui"; sleep 3
tail -4 /tmp/run/chat.log | cut -c1-200
