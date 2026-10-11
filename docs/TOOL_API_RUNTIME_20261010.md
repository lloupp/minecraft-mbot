# Ciclo seguinte — Tool API ligada ao runtime

Base `cdb848d3c432b9c2a0a99d3f96d51099a275a707` da PR #90 (CI confirmada verde antes deste ciclo). Branch `feat/tool-api-runtime-20261010`. Sem merge ou mudanças em main.

## Concluído e verificado

- `index.js` inicializa a API somente com `MBOT_TOOL_API=1`; `ToolApiRuntime` carrega checkpoints, escuta exclusivamente no loopback e instala `MinecraftToolLayer` em workers restaurados e novos. Desligado: sem listener, I/O de checkpoint ou mudanças nos workers.
- Reserva síncrona do worker ocioso antes de salvar checkpoint: a colônia não o considera livre. O executor reconfere ownership após `waitReady`, antes de cancelar/começar trabalho. Comandos externos, defesa, morte ou desconexão invalidam a reserva. Busy e ações concorrentes são recusadas, inclusive enquanto a persistência está pendente.
- `stop` cancela imediatamente; não fica atrás da gravação da requisição anterior. A resposta de uma ação interrompida não pode declarar sucesso tardio. Checkpoints concluídos repetem o resultado sem reexecutar ações, incluindo após reinício.
- Shutdown fecha HTTP, remove camadas/listeners, cancela somente ações ainda pertencentes à API e aguarda brevemente sua conclusão/persistência. Trabalho sem conclusão vira recuperação explícita no reinício. SIGINT/SIGTERM integrado ao encerramento do bot, com flush da WorldMemory quando ativa.
- Checkpoint inválido/porta ocupada desativam apenas a API; o arquivo inválido é preservado. Falha ao salvar antes da execução não libera ação física.
- Bug descoberto ao usar o store real: IDs `__proto__`, `constructor` e `toString` acessavam propriedades herdadas. Dicionário sem protótipo e lookup de chaves próprias preservam esses IDs como registros normais; IDs malformados são rejeitados antes de consultar o store. HTTP preserva tipos falsy para validação, sem convertê-los silenciosamente em defaults.
- Configuração e documentação corrigidas, incluindo escopo local de confiança e autoridade de modelos. A API não chama Julia nem muda sua autoridade; o experimento separado permanece no código e foi desativado nos testes.

## Validação

[evidências](evidence/tool-api-runtime-20261010/README.md): suíte completa Node, testes Python, sintaxe, gauntlet determinístico, logs do servidor/clientes e harness reproduzível `scripts/tool-api-live-smoke.js`.

Smoke com **index.js completo**, Minecraft Java 1.20.1 real, survival/peaceful, mundo descartável e terreno controlado pelo console. Verifica flag desligada, worker real, HTTP → coleta → delta de inventário, movimento → posição confirmada, replay, bloqueio de origem, busy/stop, SIGTERM e replay após reinício. Não substitui o soak natural.

## Pendências e próxima prioridade

Continuação: [ownership e soak natural pareado](NATURAL_SOAK_20261011.md). Corridas de despacho automático e drain corrigidas; o cenário curto não substitui sobrevivência sustentada.

| Prioridade | Trabalho | Critério de aceite / validação | Dependências / esforço |
|---|---|---|---|
| P1 | Soak em terreno natural, incluindo dois workers | Execuções pareadas a partir do mesmo snapshot; registrar todas as falhas, mortes, fome, abrigo, cancelamentos e conflitos; demonstrar limites de ownership entre API/colônia com mundo real | Servidor/mundos isolados, duração suficiente / médio |
| P1 | Expandir smoke físico para craft, deposit, withdraw e eat | Conferir servidor/inventário/estoque antes/depois, cancelamento e efeitos já submetidos; evitar apresentar fixtures como validação física | Mesa, estoque e ingredientes em mundo descartável / médio |
| P2 | Expor inspeção e recuperação explícita de checkpoints interrompidos | Consultar progresso/efeitos reais e decidir ação manual; nunca repetir craft/coleta automaticamente | Design de recuperação compatível com store / médio |
| P2 | Limitar crescimento dos checkpoints e separar identidade de mundo | Arquivos grandes respeitam política de retenção; troca de mundo não mistura evidência; dados existentes preservados | Política de retenção/identidade / médio |

Nenhuma funcionalidade ficou implementada sem testes neste ciclo. As ações adicionais acima estão planejadas, não iniciadas; não houve deploy, migração ou concessão de autoridade a modelo.
