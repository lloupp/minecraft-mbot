#!/bin/bash
. /tmp/run/lib.sh
mkdir -p /tmp/run/jauth; bash /tmp/run/jboot.sh >/dev/null
echo "$(date +%s) bot_start_fresh" >> /tmp/run/jauth/infra.log
C "tp eduardo 240 64 -110"; (setsid nohup bash /tmp/run/start_julia.sh >/dev/null 2>&1 &); sleep 30
C "tp eduardo_bot 241 64 -110"; sleep 4; P "!base aqui"; sleep 3; grep "agora é a base" /tmp/run/chat.log | tail -1 | cut -c1-120
C "tp eduardo 240 110 -110"; C "tp eduardo_bot 250 66 -100"; sleep 2; P "!bot criar explorador 1"; sleep 15
C "data get entity explorador_01 Inventory"; sleep 1; tail -1 $SO/mcserver/server.log | cut -c30-120
(setsid nohup bash /tmp/run/jfeed.sh >/dev/null 2>&1 &); (setsid nohup bash /tmp/run/jwatch.sh >/dev/null 2>&1 &); (setsid nohup bash /tmp/run/jpos.sh >/dev/null 2>&1 &)
sleep 2; date -u +%H:%M:%S
