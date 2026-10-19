# A Julia-1 evita `gather_materials` por falta de contexto ou por viés? — 1.20.1

HEAD `bec7eca`; Julia-1 só em shadow (`executionAuthority:"none"`); nenhum código nem guardrail alterado.
`npm run check` OK; `npm test -- --test-name-pattern="player-loop|shadow"` **64/64**.

Método: plataforma isolada (piso de **terra**, para não haver pedra de fundo), recursos colocados nas posições exatas
da grade de amostragem de `nearbySignals` (distâncias controladas), sem arma equipada/no inventário, sem material para
arma, sem ameaça, food 20. Explorador = objetivo `explore`; minerador (`stone_pickaxe` em mãos) = `mine_iron`.
O candidato `gather_materials` **não traz distância nem quais recursos existem na descrição** (ao contrário de
`find_food`): o contexto só chega em `state.nearby.*`.

## Runtime (estados reais; estados repetidos dão escolha idêntica — determinístico)

| Grupo | Estado (distâncias medidas) | Decisões c/ Julia | `gather_materials` | `continue_objective` | Confiança |
|---|---|---|---|---|---|
| G1 madeira/pedra(/ferro) bem próximas | 2 / 2 / (2), base 293 | 8 | **0** | 8 | explore 0,999 · mine_iron 0,72 |
| G2 recursos distantes | 5,7 / 5,7–6 / (5,7), base 293 | 8 | **4** (todas mine_iron) | 4 (explore) | explore 0,652 · mine_iron **0,526** |
| G3 sem recursos próximos | — | 0 (6 despachos com 1 candidato: `continue_objective`) | — | — | Julia não consultada |
| G4 só madeira (2–4), **base longe** (293) | explorador ×6 | 6 | **0** | 6 | 0,982–1,0 |
| G5 só madeira (2–4), **base perto** (8) | explorador ×6 | 6 | **0** | 6 | 1,0 |

Latência: explorador 340–460 ms; minerador 1,1–1,4 s (concorre com A*). Erros/timeouts/inválidas/safety violations: **0**.
G4/G5 do minerador ficaram inválidos (falhas repetidas em G3 ⇒ streak ≥3 ⇒ `stop_task` forçado, 8 despachos) e foram
substituídos pelas 6 variações de posição do explorador. A base (293 × 8) **não** mudou nada.

## Varredura offline (payload real; recursos disponíveis × distância × ordem; resto do estado fixo)

7 subconjuntos de recursos × 6 distâncias (1–6,9) × 2 ordens, por objetivo (84 cada):

| Objetivo | `gather_materials` | P(gather) máx. | Observações |
|---|---|---|---|
| `explore` | **0/84** | 0,27 | nenhuma combinação muda a escolha; sem recursos nos flags: 0,008 |
| `mine_iron` | 19/84 | 0,95 | **ordem**: 14/42 com `continue_objective` listado primeiro × 5/42 com `gather_materials` primeiro; **não monotônico** com a distância (d=1: 8/14, d=2: 1/14, d=3: 4/14, d=4: 2/14, d=5,7: 2/14); `wood` sozinho 0/12; sem recursos: 0,016 |

## Conclusão

**Viés persistente, não falta de contexto.** No `explore` a Julia ignora por completo a presença, o tipo, a distância dos
recursos e a distância da base (0/30 no runtime, 0/84 offline). No `mine_iron` ela *às vezes* escolhe `gather_materials`,
mas conforme a **posição do candidato** e de forma não monotônica — não é sensibilidade a "recurso claramente próximo"
(a 2 blocos: 0/4 no runtime; a 5,7: 4/4 com confiança 0,53). Nenhum guardrail foi criado.

## Próximo ajuste mínimo (não implementado)

1. Dar contexto na **descrição** de `gather_materials` como já se fez em `find_food` ("Nearby wood ≈ 2,0 blocos, stone ≈ …") e
   repetir só este teste; é o único ajuste que testa "falta de contexto" de forma justa.
2. Se ainda ignorar, tratar como limitação: decidir `gather_materials` deterministicamente (sem recurso/arma/material e
   recurso ≤ X) em vez de delegar à Julia. E mitigar o viés de posição embaralhando/balanceando a ordem dos candidatos.

## Tentativas descartadas

O driver teve 3 rodadas inválidas (piso de pedra dando `stone` sempre a 1 bloco; deriva do explorador antes do despacho;
`tp` com z=−317,5 fora da grade de amostragem; workers não restaurados após reinício; `mv` de log com o runtime aberto). Só
a rodada final entra nos números. Arquivos: `runtime/`, `gsweep.json`/`gsweep.py`, `gather_groups.sh`, `g45.sh`,
`gather_analysis.py`, `probe.js`, `tee_proxy.py`.
