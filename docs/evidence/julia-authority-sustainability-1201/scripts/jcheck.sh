#!/bin/bash
date -u +%H:%M:%S
python3 /tmp/run/jfinal.py /tmp/run/jauth 2>/dev/null | python3 -c "import json,sys;d=json.load(sys.stdin);print('dur',d['duracao_min'],'dec',d['decisoes'],'julia',d['julia_validas'],'fb',d['fallbacks'],'mortes',d['mortes'],d['mortes_causas']);print(' gains',d['itens_ganhos']);print(' acoes',d['acoes']);print(' loops',d['repeticoes_>=10_ciclos_identicos'][:4])"
tail -n +3 /tmp/run/jauth/infra.log
