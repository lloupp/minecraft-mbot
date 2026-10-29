# Impacto: fila de pedidos da colônia

## Alvo
Fila persistente de pedidos explícitos para workers; prioridade global de coleta fica para uma etapa posterior.

## Dependências
- `core/ColonyOrchestrator.js`: `assign`, `runRoleTask`, projeto automático, seleção de workers ociosos e ciclo `tick`.
- `core/WorkerController.js`: `run` cancela a tarefa anterior, e `cancel` também ocorre por defesa, morte e desconexão; conclusão precisa distinguir sucesso, falha e cancelamento.
- `index.js`: comandos `!ordem`, `!construir`, demais ordens diretas, `!tarefas`, painel, inicialização e `persistState`.
- `core/StateStore.js` e `core/ProjectManager.js`: escrita e restauração do estado; retomar sem duplicar trabalho físico exige verificar resultados anteriores.
- `core/StorageManager.js`: depósitos dependem do baú estar acessível e da capacidade; não assumir que um item coletado foi depositado.
- `core/DemandPlanner.js`: tarefas automáticas não devem impedir pedidos explícitos pendentes.

## Testes e riscos
- `test/core.test.js` cobre distribuição de ordens, projetos e estado; `test/worker.test.js` cobre tarefas e cancelamento.
- Faltam testes de fila durável, concorrência entre pedidos e modo automático, reinício durante execução, erros parciais de mineração e confirmação de depósito.
- Risco: alto. Reiniciar uma tarefa sem reconciliar o que já foi coletado pode duplicar resultados; nova ordem não pode cancelar outra silenciosamente; depósitos podem falhar ou ficar incompletos.

## Escopo proposto
1. Registrar pedidos com identificador, argumentos, progresso, status e motivo de falha; salvar antes de iniciar trabalho.
2. Distribuir por capacidade e ociosidade sem cancelar tarefas existentes; permitir pedidos em paralelo quando houver workers adequados.
3. Exibir pendentes, em andamento, concluídos e falhas em `!tarefas` e na dashboard; permitir cancelamento explícito.
4. Após reinício, marcar pedidos interrompidos para reconciliação; não presumir conclusão nem duplicar coleta.
5. Coleta de minerais usa confirmação real de itens e depósito no baú central existente; baú cheio ou inalcançável mantém pedido bloqueado ou parcial sem apagar itens.
6. Depois, projetar comando prioritário que suspenda pedidos comuns de forma segura e distribua uma meta total entre workers capazes; não tratar 64 por worker como meta de 64 total. Criar depósito na base como projeto separado se o baú existente não for suficiente.
