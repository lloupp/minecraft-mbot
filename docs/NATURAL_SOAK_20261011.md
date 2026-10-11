# Ownership API/colônia e soak natural pareado

Base: PR #91, commit `31acec8e9fd5f6609b5e107b1a534033b945f7ec`. Branch de trabalho `test/natural-two-worker-soak-20261011`. Sem merge/deploy; autoridade Julia desativada nas execuções.

## Correções comprovadas

- `ColonyOrchestrator.runAuto` agendava uma microtask sem revalidar o estado observado no planejamento. Uma reserva API tomada nesse intervalo era cancelada pela ordem automática obsoleta. O despacho agora reconfere disponibilidade e versão antes de executar e depois de `waitReady`. Interrupção recebe backoff sem ser contada como falha operacional.
- `stop` invalidava a reserva imediatamente, mas uma operação API de produção/estoque podia ainda estar pendente; a colônia considerava o worker ocioso e reutilizava seu pathfinder/janela. `_toolDrain` mantém o worker indisponível ao scheduler até a ação e sua persistência terminarem, com limpeza por identidade. O outro worker permanece independente.
- Comandos explícitos e defesa conservam sua precedência. Operações nativas já submetidas de craft/estoque não são revertidas nem automaticamente repetidas; sua preempção física continua sendo uma limitação a investigar.

- Exceção física posterior a cancelamento perdia `reason=cancelled`, classificando o checkpoint como falha. O caminho catch agora reconfere ownership e conserva o erro original junto com o motivo da interrupção. Teste de regressão confirma checkpoint `cancelled`.

## Reprodução

```bash
MBOT_TEST_SERVER_JAR=/caminho/server-1.20.1.jar \
MBOT_TEST_EULA_ACCEPTED=1 \
MBOT_SOAK_SECONDS=120 \
node scripts/tool-api-natural-soak.js
```

O harness executa `index.js` completo e servidor Java, em diretórios temporários. Gera terreno normal com seed 42, escolhe superfície próxima a madeira natural, configura spawn e um baú vazio. Nenhum alimento, ferramenta ou tronco é injetado. Dois lenhadores survival/normal são restaurados; o observador fica spectator.

Cada braço recebe uma cópia do mesmo snapshot, conferida por manifest SHA-256 antes do servidor iniciar. Controle usa a API apenas para leitura; experimento submete coleta concorrente, testa busy, ativa colônia, cancela só um worker e acompanha o segundo. Ambos recebem noite na metade do intervalo. Saúde, fome, mortes, tarefas, resultados e inventário são registrados; processos possuem encerramento limitado por prazo. Requisições pendentes têm tratamento imediato de rejeições.

O teste é curto e dirigido: comparação de snapshot não torna mobs/tempos determinísticos, nem comprova sobrevivência sustentada, defesa, alimentação ou construção de abrigo.

## Backlog atualizado

| Prioridade | Trabalho | Aceite / validação | Dependência / esforço |
|---|---|---|---|
| P1 | Investigar timeouts reais de abertura do estoque | Instrumentar sneak, alcance ocular e face/obstrução no instante de abrir; reproduzir e confirmar correção sem ocultar erros | Baú no terreno natural, médio |
| P1 | Concluir preempção física de craft/deposit/withdraw | Interromper durante janela/craft, iniciar ordem explícita e provar ausência de disputa de janela/pathfinder; conferir efeitos já submetidos | Mesa/estoque/ingredientes reais, médio |
| P1 | Soak mais longo e diversificado | Vários seeds, ciclo dia/noite completo, fome, ameaças móveis, morte/reconnect e progresso real; conservar todos os fracassos | Servidor descartável, médio |
| P2 | Recuperação explícita de checkpoints interrompidos | Inspecionar efeitos reais antes de nova ação; impedir replay automático de efeitos desconhecidos | Design de recuperação, médio |
| P2 | Retenção e identidade de mundo dos checkpoints | Limitar crescimento e impedir mistura de mundos preservando registros existentes | Política de retenção, médio |

## Validação concluída

- `npm run check` e sintaxe do harness: aprovados. `npm test`: 711/711; suites direcionadas: 42/42.
- Par final real: 120 s por braço, cópias idênticas do snapshot, 62/59 amostras, HP/fome mínimos 20, zero mortes. Busy e stop isolado entre workers passaram. Stop seguido de windowOpen timeout agora preservou checkpoint cancelado.
- Inventário terminal: controle A=1 log/B=0; experimento A=5 logs/B=9. A ação API de B confirmou oito itens antes do cancelamento final; objetivo de 64 não concluído. Não há atribuição causal de produtividade entre braços.
- Evidências e fracassos preservados: [registro](evidence/natural-two-worker-20261011/README.md).
- Pendências comprovadas: timeouts intermitentes windowOpen de estoque e `pos.floored is not a function` em uma tentativa de pickup. Nenhuma causa raiz foi afirmada ou escondida. Próxima prioridade: reproduzir e instrumentar esses dois erros físicos, começando pela interação de estoque.
