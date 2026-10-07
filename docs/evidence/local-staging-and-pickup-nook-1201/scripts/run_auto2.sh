. /tmp/run/auto.sh
autorun2 ${1:-45} ${2:-317} ${3:-313}
autoshow $(cat /tmp/run/ar.N) > ${4:-/tmp/run/ar.out}; echo FIN >> ${4:-/tmp/run/ar.out}
