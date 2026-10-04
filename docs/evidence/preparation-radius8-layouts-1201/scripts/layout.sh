# uso: layout.sh <NAME>  -> define variáveis do camp (tabela, árvores, baú, start, pedra)
case "$1" in
 A) TABLE="-14 72 -182"; CHEST="-14 72 -177"; START="-14.5 72 -179.5"; TREES="oak -9 72 -178|oak -6 72 -184|birch -10 72 -172"; STONE="-20 71 -186 -17 71 -176";;
 B) TABLE="-12 72 -176"; CHEST="-12 72 -178"; START="-12.5 72 -177.5"; TREES="oak -8 72 -172|oak -5 72 -178|birch -9 72 -184"; STONE="-20 71 -184 -17 71 -172";;
 C2) TABLE="-13 72 -170"; CHEST="-13 72 -168"; START="-13.5 72 -169.5"; TREES="birch -9 72 -166|oak -8 72 -174|oak -11 72 -163"; STONE="-21 71 -176 -17 71 -164";;
 C) TABLE="-13 72 -170"; CHEST="-13 72 -168"; START="-13.5 72 -169.5"; TREES="birch -7 72 -166|oak -6 72 -173|oak -10 72 -163"; STONE="-21 71 -176 -17 71 -164";;
esac
