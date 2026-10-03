# Lote 1 (fix/runtime-autonomy-stability) — validação física em Minecraft 1.20.1

Runtime real de `/home/user/wt-pr1` (código = `main` + lote 1, **sem flags**), servidor vanilla 1.20.1 descartável.
- `!ordem lenhadores madeira 8` com 4 carvalhos a 20–31 blocos: `ok: true, gathered: 8`; inventário real (`data get entity`): 8× oak_log.
- `!ordem lenhadores madeira 20` + `!todos voltar` após 14 s (nova ordem cancela a tarefa): `ok: false, code: 'CANCELLED', gathered: 2`
  com `itemConfirmed: true` nas duas tentativas entregues e **2× oak_log** no inventário real — o cancelamento não desfaz item já entregue
  e não conclui nem deposita a tarefa.
Logs: `gather-and-cancel.txt`.
