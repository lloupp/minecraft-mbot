# Prioridade de coleta e fila de tarefas

Minecraft Java 1.20.1. Os comandos abaixo funcionam no chat do dono.

## Comandos

- `!prioridade ferro 64`: mobiliza auxiliares para coletar ferro imediatamente.
- `!prioridade minerais 128`: distribui a meta entre diferentes minérios da dimensão.
- `!prioridade diamante 16`, `!prioridade madeira 64`, `!prioridade comida 24`: outros recursos.
- `!prioridade status` e `!prioridade parar`: acompanhamento e cancelamento.
- `!fila adicionar <recurso> [quantidade]` e `!fila frente <recurso> [quantidade]`: enfileirar.
- `!fila listar`, `!fila subir <id>`, `!fila remover <id>`: lista e ordenação.
- `!fila pausar`, `!fila retomar` e `!fila limpar`: execução da fila.
- `!tarefas` continua exibindo atividade individual dos auxiliares.

Os apelidos de minérios reconhecem carvão, ferro, cobre, ouro, redstone,
lápis-lazúli, diamante, esmeralda, ametista, quartzo, ouro do Nether e detritos
ancestrais, além de variantes deepslate e minérios registrados pelos mods.

O grupo `minerais` contabiliza quantidade agregada; não obriga obter cada família.
Minérios do Nether são elegíveis somente se o worker já está nessa dimensão.
Não acontece troca de dimensão automática.

## Dashboard

Ative `MBOT_DASHBOARD=1` e abra o endereço mostrado pelo bot, normalmente
`http://127.0.0.1:3006/dashboard`. Há botões rápidos individuais para todos
os minérios, formulário de recurso e quantidade, execução imediata, inclusão no
início/fim da fila, status em tempo real, subir/descer/remover, pausa, retomada,
cancelamento e limpeza dos pendentes.

A rota `POST /api/tasks/action` aceita apenas uma lista restrita de ações,
localmente, verificando Host e Origin e exigindo cabeçalho customizado.
Não exponha o dashboard à Internet.

## Semântica e limites

- Ordens do dono passam à frente do planejamento automático normal.
- Defesa, alimentação e ações críticas de inventário, crafting e construção
  não são interrompidas à força.
- A troca de tarefa aguarda terminar a execução física antiga (drain).
- O progresso é baseado nos relatórios de coleta confirmada dos workers.
- Lotes de até 12 blocos por worker, ordens de 1–4096 unidades, até 100 pendentes.
- Três falhas sem coleta bloqueiam um trabalhador no modo de recurso específico.
- No modo de todos os minérios, tenta outras famílias disponíveis.
- As tarefas são salvas no StateStore e reaparecem após restart. Trabalho que
  estava em voo durante crash precisa de reconciliação física para garantir
  que a contagem não tenha sido excedida.

## Gates antes do merge

1. CI verde: npm run check, npm test, gauntlet.
2. Servidor descartável 1.20.1 com pelo menos 2 auxiliares: coletar de verdade,
   confirmar delta físico de inventário/estoque, comando prioritário durante
   coleta normal e segurança de defesa/crafting.
3. Reinício durante fila e ordem ativa, cancelamento e reconexão.
4. Botões de dashboard e bloqueio de POST externo.
5. Testes Forge modado para minérios adicionais.

A PR está em draft; não foi executado nenhum teste no mundo do usuário.
