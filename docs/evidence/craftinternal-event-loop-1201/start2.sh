#!/bin/bash
# usage: start2.sh <root> <cpx_out>
export MBOT_ROOT=$1 CPX_OUT=$2
cd $1; . /tmp/run/env.sh; export MBOT_JULIA_SHADOW=0 MBOT_LAYA_SHADOW=0
exec node --require /tmp/run/cpx.js index.js >> /tmp/run/bot-current.log 2>&1 < /dev/null
