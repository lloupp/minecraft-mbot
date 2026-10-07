# uso: . common.sh I   (I = A|B)
I=$1; M=/tmp/run/m; D=$M/srv-$I
case $I in A) PORT=25571;; B) PORT=25572;; *) PORT=25573;; esac
FIFO=$M/player-$I.fifo; CHAT=$M/chat-$I.log
C() { echo "$1" > $D/in.fifo; }
P() { echo "$1" > $FIFO; }
