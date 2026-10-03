# Streak de falhas resolvidas (`ok:false`) e prova de rota alternativa — 1.20.1

HEAD `ad0fe1b` da branch `experiment/julia-laya-andy-player-loop-v2`. Julia-1 em shadow mode,
**sem autoridade de execução**. `npm ci`, `npm run check` OK; `npm test` **423/423**.
Nada do runtime foi alterado; `alternativeRoute` **continua `false`**.

Instrumentação de teste (fora do repositório, só leitura): `probe.js` grava, para cada despacho
de worker, o estado capturado (`consecutiveFailures`, candidatos) e, para cada tarefa, o desfecho
(`resolved/rejected`, `ok`, `code`, `cancelled`, `interrupted`) e o streak logo depois.

## 1. O streak acumula com falhas reais — confirmado

Cenário: `minerador_01` numa plataforma no céu (sem recursos naturais), a **mesma ordem**
`!ordem minerador iron_ore 1`, com um minério de ferro **selado em bedrock** novo a cada ordem
(`GoalGetToBlock` inalcançável ⇒ `ok:false, code:'PATH_FAILED'` resolvido, não exceção).
O `stone_pickaxe`, a mesa, gravetos e pedra foram entregues antes (evita #79 e gera 2 candidatos).

| Despacho | `consecutiveFailures` capturado | Candidatos | Desfecho da tarefa | Streak depois |
|---|---|---|---|---|
| D#1 | **0** | `prepare_combat, continue_objective` | `ok:false PATH_FAILED` | 1 |
| D#2 | **1** | idem | `ok:false PATH_FAILED` | 2 |
| D#3 | **2** | idem | `ok:false PATH_FAILED` | 3 |
| D#4 | **3** | `stop_task` (forçado) | `ok:false PATH_FAILED` | 4 |
| D#5 | 4 | `stop_task` (forçado) | **`ok:true`** (minério aberto) | **0** |
| D#6 | 0 | `prepare_combat, continue_objective` | `ok:false PATH_FAILED` | 1 |

Ou seja `consecutiveFailures 0 → 1 → 2 → 3 (→ 4)`, e um **sucesso posterior zera** o streak (repetido:
D#10 → `ok:true` → 0; D#14 → `ok:true` → 0; D#17/D#22 no explorador). Nos estados 0, 1 e 2 a Julia foi
consultada (14 linhas do minerador; `consecutiveFailures` vai no payload; sempre `prepare_combat`,
conf. ≥0,996, sem erros/timeouts/inválidas); com `cf ≥ 3` e `alternativeRoute=false` o conjunto é
`[stop_task]` e **nenhum** payload com `stop_task` chegou ao sidecar (0 de 41 payloads; 6 despachos forçados), ou seja,
a Julia não foi consultada. Julia sem autoridade, `executionAuthority:"none"`.

## 2. Achados: o que a correção `1459dae` conta de fato

| # | Caso | Medido | Esperado pelo pedido |
|---|---|---|---|
| A | `ok:false` + `PATH_FAILED` resolvido | incrementa (1→2→3) | ✅ |
| B | sucesso posterior | zera | ✅ |
| C | resultado com `cancelled:true` explícito (`!enviar` interrompido, `goToPoint`) | **não incrementa**, mas **zera** (3→0, R#21) | não conta ✅ (zerar é decisão implícita do código/teste) |
| D | **cancelamento real do *gather*** (reemissão da ordem) devolve `ok:false, code:'CANCELLED'` **sem** `cancelled:true` | **incrementa** (2→3, R#8 e R#13; `interrupted:true`) | ❌ conta como falha |
| E | **cancelamento real do explorador** (`goTo` interrompido) **rejeita** "The goal was changed…" | **incrementa** (R#15,16,18,19,20; `interrupted:true`) | ❌ o handler de rejeição ignora `isCancelled()` |
| F | streak por objetivo | **por worker**: rejeições de `explorar` e de `enviar` acumulam juntas (R#18–20) | pedido: mesmo objetivo |

Consequências observadas: no smoke de segurança (26 despachos) `consecutiveFailures` chegou a **7** e
6 das 15 "falhas" eram cancelamentos por reemissão; 2 despachos viraram `[stop_task]` forçado só por
isso. E o forçamento de `stop_task` em `cf≥3` fica errado mesmo com falhas genuínas: em D#5 e D#10
(`cf=4`) a ordem seguinte teve **sucesso** num alvo alcançável. (Um `PATH_FAILED` extra em R#9 foi erro
meu de geometria: o minério "aberto" caiu dentro de uma gaiola.) Sugestões, não implementadas: não
contar `interrupted`/`code:'CANCELLED'`/rejeição com `isCancelled()`, não zerar em cancelamento, e
manter o streak por (objetivo, alvo).

## 3. Regressão de segurança

Smoke (ameaça com/sem arma, exploração, noite/base, interrupção/retomada): Julia 21 linhas, 0 erros,
0 timeouts, 0 inválidas, 0 fora da allowlist, 0 safety violations, 0 abandonos. **Precedência
ameaça×fome (fix `!state.threat`)**: 34/34 despachos com fome 1–10 e zumbi resultaram em
`[escape_danger]` (nenhum `find_food` forçado sob ameaça). Latência da Julia nesse trecho p50 883 /
p95 2013 ms — inflada porque o bot de sondagem rodava A* de 10 s em paralelo (lag do event loop
máx 2041 ms nessa janela); não é medida limpa.

## 4. O runtime consegue provar uma rota alternativa? — **Não** (mantido `alternativeRoute=false`)

O que existe e foi medido (pathfinder real do runtime, mesmos flags dos workers: `canDig=false`,
`allow1by1towers=true`; `pathfinder_probe`, gerador `getPathFromTo` até sair de `partial`):

| Alvo | `default` (worker) | `canDig=true` | restritivo |
|---|---|---|---|
| plano aberto | success (8 nós) | success | success |
| cela de **pedra** | **timeout** (10 s, ~32 mil nós) | **success** (723 nós, 1,2 s) | timeout |
| cela de **bedrock** | timeout | timeout | timeout |
| topo de pilar de 6 (sem blocos de andaime) | timeout | timeout | timeout |

1. **Resultado do pathfinder:** para alvo inalcançável o pathfinder devolveu **`timeout`, nunca `noPath`**
   (mundo aberto: a busca não esgota). O runtime não distingue "inalcançável" de "lento" (mensagem
   "Took to long to decide path to goal!" / o `caminho demorou demais` do worker).
2. **Movements diferentes:** só `canDig=true` mudou um resultado (pedra), mas o worker usa `canDig=false`
   de propósito (proteção de terreno/currais) — é rota **destrutiva**. Executando com `canDig`, o bot
   cavou até a parede (a 1 bloco da meta) e **não concluiu em 20 s**; sem confirmação de chegada.
   Bedrock, alvo flutuante e pilar continuam inalcançáveis em qualquer configuração.
3. **Segundo alvo alcançável:** já acontece **dentro** de uma ordem — o `gather` tenta o próximo
   candidato. Evidência real: uma ordem com minério exposto porém inalcançável mais perto e outro aberto
   mais longe → tentativa 1 `PATH_FAILED` ("caminho demorou demais"), tentativa 2 confirmada, **`ok:true`,
   streak 0**. Quando a ordem devolve `ok:false PATH_FAILED`, por construção **todos** os candidatos do
   raio (48) não "lembrados" já falharam: não sobra alvo alternativo para provar.
4. **Sucesso após a rota padrão falhar** só existe nesse caso `ok:true` (recuperação já tratada, sem
   `consecutiveFailures`), não como evidência para um `ok:false`.

**O que falta** para poder pôr `alternativeRoute=true` sem heurística: (a) distinguir inalcançável de
lento (busca limitada/fatiada com limite de nós e status `noPath`); (b) uma política explícita sobre
Movements alternativos não destrutivos (hoje o único que funcionou é destrutivo); (c) streak por
(objetivo, alvo) com motivo da falha, para haver noção de "alvos já tentados"; (d) confirmação por
execução (chegada verificada). **Proposta mínima, se (a)–(d) existirem:** após `PATH_FAILED` no alvo T,
`alternativeRoute=true` só se houver um candidato T2 (mesmo recurso, fora do conjunto lembrado, dentro do
raio) cujo `getPathFromTo` **fatiado e limitado** com os `Movements` padrão devolva `success`; limpar o
campo quando T2 for consumido. Cuidado com custo: a sondagem síncrona de 10 s por alvo bloqueia o event
loop (lição do #79). Nada disso foi implementado.

## Arquivos

`runtime/` (`probe-dispatch.jsonl` com despachos e desfechos, linhas do shadow, payloads, journal do
smoke, lag), `pathfinder/routeprobe.jsonl` (a 2ª dupla de `go` rodou com a cela já cavada e não vale;
vale a 1ª: default timeout a 2,2 blocos; `canDig` chegou a 1 bloco sem concluir), `probe.js`,
`routeprobe.cjs`, `smoke.sh`, `hunger_guard.sh`, `tee_proxy.py`.
