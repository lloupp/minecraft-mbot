# Execução real e limites

`report.json`: par final aprovado somente nas checagens de ownership, 120 segundos por braço, Minecraft Java 1.20.1, normal/survival, seed 42, dois lenhadores e index.js real. Manifest SHA-256 confirmou cópias idênticas do snapshot inicial. Julia e demais modelos desligados. `summary.json` resume métricas; logs e checkpoints conservam ações/efeitos físicos.

Controle terminou com um dark_oak_log no primeiro worker. Experimento terminou com 5 logs no primeiro e 9 no segundo. A requisição API do segundo confirmou oito itens e foi cancelada ao final (não cumpriu o objetivo de 64). O primeiro stop preservou erro windowOpen posterior como cancelled; o segundo worker continuou. HP/fome mínimos 20 em ambos, zero mortes; isso não comprova sobrevivência prolongada.

Continuam timeouts de abertura de estoque e uma tentativa com `pos.floored is not a function`. Houve recuperação e coleta física depois, mas as causas desses erros não foram corrigidas neste ciclo.

`failed-and-superseded/` conserva ensaios anteriores: inicial com fixture de baú bloqueado, cleanup/promise inadequados e sem relatório final (output preservado); blocked-neighbor com baú adjacente bloqueado; cancel-classification com baú livre e falha real de classificação do cancelamento, corrigida antes do par final. Esses ensaios não contam como aprovação nem comparação causal.

711 testes Node e 42 testes direcionados aprovados; npm run check e sintaxe do harness aprovados. Servidor Java oficial usado de teste anterior: SHA-1 84194a2f286ef7c14ed7ce0090dba59902951553. Mundos/servidor jar não incluídos. Reprodução e backlog em ../../NATURAL_SOAK_20261011.md.
