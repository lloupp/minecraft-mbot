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

Exemplo com três execuções já versionadas:

```bash
node scripts/export-embedding-memory-corpus.js \
  docs/evidence/julia-authority-sustainability-1201/runs/equip-threat/julia-authority.jsonl \
  docs/evidence/julia-authority-sustainability-1201/runs/food-after/julia-authority.jsonl \
  docs/evidence/julia-authority-sustainability-1201/runs/nav-post-r4/julia-authority.jsonl \
  > /tmp/minecraft-experiences.json
```

Também pode apontar para `.data/julia-authority.jsonl` após uma sessão física.

## 2. Rodar EmbeddingGemma 2 localmente

Com `uv`:

```bash
uv run scripts/embeddinggemma2-memory-benchmark.py \
  --corpus /tmp/minecraft-experiences.json \
  --dimensions 256 \
  --top-k 3 \
  --output .data/embeddinggemma2-memory-results.json
```

O primeiro uso baixa o modelo `google/embeddinggemma-2`.

A configuração inicial usa:

- `SearchQuery` para estados atuais;
- `Document` para experiências históricas;
- vetores truncados para **256 dimensões**;
- cosine similarity;
- somente episódios anteriores ao episódio avaliado;
- **somente decisões com 2+ candidatos na pontuação principal**.

Episódios com um único candidato continuam disponíveis como memória histórica, mas não contam na métrica principal.
Isso evita que decisões forçadas inflem artificialmente o resultado. Para diagnóstico, `--all-decisions` inclui tudo.

## Métricas

- `semanticTop1SameAction`: top-1 recuperado tem a mesma ação do episódio atual;
- `recencyTop1SameAction`: baseline — episódio imediatamente anterior tem a mesma ação;
- `semanticUsefulAtK`: top-k contém experiência anterior bem-sucedida com a mesma ação;
- `mrrSameAction`: posição média da primeira experiência com a mesma ação;
- tempo de carregamento e geração dos embeddings.

## Gate para próxima fase

Não ligar a recuperação ao Julia ao vivo ainda.

Avançar para **shadow online** somente se:

1. houver número razoável de episódios reais e variados com 2+ candidatos;
2. `semanticTop1SameAction` superar recência de forma material;
3. `semanticUsefulAtK` mostrar recuperação útil em ameaça, fome, preparação e exploração;
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
