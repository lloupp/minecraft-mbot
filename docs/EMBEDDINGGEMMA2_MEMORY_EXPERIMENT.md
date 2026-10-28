# EmbeddingGemma 2 — experimento de memória episódica em shadow

## Objetivo

Testar `google/embeddinggemma-2` como **recuperador de experiências anteriores** do bot Minecraft.

O experimento não controla Mineflayer, não altera candidatos, não modifica guardrails e não dá autoridade ao modelo.
A primeira pergunta é somente:

> Para um estado atual do bot, o embedding recupera episódios anteriores semanticamente úteis melhor que um baseline simples por recência?

## Por que não substituir a WorldMemory

`WorldMemory` continua adequada para coordenadas, distância, validade, hazards e confirmação física. Embeddings não são
uma boa substituição para geometria/pathfinding.

EmbeddingGemma 2 entra em outra camada: **memória episódica**. Exemplos:

- ameaça + arma + vida + fuga/luta + resultado;
- fome + distância da base + comida disponível + resultado;
- preparação de materiais + bloqueio + recuperação;
- exploração + falha de rota + comportamento posterior.

## Fonte de dados

Use logs reais já produzidos por Julia em shadow/authority:

- eventos `julia_authority_cycle`;
- evidência `julia_shadow_decision` que contenha `result`.

O corpus inclui o estado **antes** da ação e o conjunto de candidatos no texto de consulta. Resultado e ação escolhida
aparecem somente no documento histórico, evitando vazar a escolha final da consulta atual.

## 1. Exportar um corpus

Todo o histórico real versionado (deduplicado, IDs prefixados pelo run):

```bash
node scripts/export-embedding-memory-corpus.js --all-evidence > .data/corpus.json
node scripts/export-embedding-memory-corpus.js --all-evidence --stats   # só estatísticas
```

Também aceita arquivos específicos, por exemplo `.data/julia-authority.jsonl` após uma sessão física.

Cada episódio tem `query`/`document` e variantes de representação para ablação (`full`, `no_inventory`,
`no_candidates`, `no_distances`, `compact`), além de `category`, `features` e `flags` de desfecho.

## 2. Rodar EmbeddingGemma 2 localmente

```bash
uv run scripts/embeddinggemma2-memory-benchmark.py --corpus .data/corpus.json --output-dir .data/bench
```

O modelo roda em CPU, só com o encoder de texto. Os embeddings ficam em cache em `.data/embedding-memory/` (ignorado
pelo Git). `--no-gemma` roda só os baselines.

- `SearchQuery` para estados atuais e `Document` para experiências históricas;
- encode único em 768d, com truncamento Matryoshka para 128/256/512/768 e renormalização;
- só episódios com `settledAt < decidedAt` da query (nunca o próprio, futuros ou ações ainda em execução);
- **somente decisões com 2+ candidatos na pontuação principal** (`--all-decisions` só para diagnóstico).

Baselines: random, recência, rule match exato (ameaça, faixa de distância, vida, fome, objetivo, conjunto de candidatos),
rule match + preferência por desfecho positivo, TF-IDF (ajustado só no passado permitido).

## Métricas

- `top1SameAction`, `hit@1/3/5`, `mrr`: proxy de "mesma ação";
- `usefulAt3`: top-3 contém episódio com mesma ação e desfecho positivo;
- `memoryUtilityAt3`: utilidade por resultado histórico, penalizando falhas, safety, cancelamentos, bloqueios, ações
  indisponíveis e categorias diferentes (definição no script);
- tudo também por categoria e por ação, com bootstrap pareado contra cada baseline e metade cronológica posterior
  (held-out);
- latência de busca, encode por query, RAM, tamanho do índice.

Testes: `node --test test/embedding-memory-corpus.test.js` e `python -m unittest discover -s test/python`.

## Resultado (2026-10-06)

**NEUTRO.** Detalhes em `docs/evidence/embeddinggemma2-memory-1201/README.md`.

291 decisões contestadas reais. Gemma 256d com representação compacta: top1 0.839 / useful@3 0.495 / utility@3 0.224.
Recência: 0.536 / 0.330 / −0.247. TF-IDF: 0.777 / 0.450 / 0.107. Rule match + desfecho: 0.869 / 0.519 / 0.194.
Gemma é claramente melhor que recência e TF-IDF, mas empata (ou perde levemente) com um rule match estruturado que
custa ~2 ms e nenhum modelo. Com texto completo, o Gemma perde até para TF-IDF.

Por isso o gate abaixo **não** foi cumprido e a integração online não foi construída.

## Gate para próxima fase

Não ligar a recuperação ao Julia ao vivo ainda.

Avançar para **shadow online** somente se:

1. houver número razoável de episódios reais e variados com 2+ candidatos;
2. superar recência **e** os baselines baratos (rule match, TF-IDF) de forma material, com IC pareado fora de zero;
3. `usefulAt3`/`memoryUtilityAt3` mostrarem recuperação útil em ameaça, fome, preparação e exploração;
4. não houver vazamento de ação/resultado para a query;
5. memória e latência forem aceitáveis no hardware alvo.

Na fase online, as memórias recuperadas entram apenas como contexto adicional do Julia shadow e continuam com
`executionAuthority = none`.

## Segurança experimental

- sem merge direto na `main`;
- sem autoridade física;
- sem mudança no `WorldMemory`;
- sem envio do log para API externa;
- modelo executado localmente;
- resultados ruins devem ser preservados;
- comparar sempre contra baseline.
