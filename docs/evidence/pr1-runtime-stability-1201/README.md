# Lote 1 (fix/runtime-autonomy-stability) — validação física em Minecraft 1.20.1

Runtime real de `/home/user/wt-pr1` (código = `main` + lote 1, **sem flags**), servidor vanilla 1.20.1 descartável.
- `!ordem lenhadores madeira 8` com 4 carvalhos a 20–31 blocos: `ok: true, gathered: 8`; inventário real (`data get entity`): 8× oak_log.
- `!ordem lenhadores madeira 20` + `!todos voltar` após 14 s (nova ordem cancela a tarefa): `ok: false, code: 'CANCELLED', gathered: 2`
  com `itemConfirmed: true` nas duas tentativas entregues e **2× oak_log** no inventário real — o cancelamento não desfaz item já entregue
  e não conclui nem deposita a tarefa.
Logs: `gather-and-cancel.txt`.

## Revalidação após o review independente (código `4995143`)
`post-review-validation.txt`, árvores frescas (área limpa + 4 carvalhos): (a) 8/8 `ok:true`, 8× oak_log reais; (c) `CANCELLED` com `gathered:4` e 5× oak_log
no inventário — um item foi recolhido por proximidade depois que o laço encerrou, então `gathered` é um piso, nunca um excesso; o inventário real é a verdade.
Uma rodada anterior com árvores sobrepostas a copas de árvores já cortadas deu `PATH_FAILED` (5/8): limitação de terreno anterior ao lote 1, não regressão.
