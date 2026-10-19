# Semântica de `consecutiveFailures` (por objetivo, cancelamento neutro) — 1.20.1

HEAD `6ed4935` da branch `experiment/julia-laya-andy-player-loop-v2`. Julia-1 só em shadow mode
(`executionAuthority:"none"`); nenhum código alterado. `npm run check` OK;
`npm test -- --test-name-pattern="shadow|failure"` **66/66**.

Método curto: `minerador_01` numa plataforma no céu, mesma ordem `!ordem minerador iron_ore 1`, um minério
selado em bedrock novo por ordem (⇒ `ok:false`), ferramentas entregues antes (#79 fora). O que vale como
evidência é o **snapshot que a Julia recebeu** (`julia-shadow.jsonl` / `julia-payloads.jsonl`). O
`probe-dispatch.jsonl` tira o snapshot *antes* do reset por objetivo do `_observeShadow`, então mostra o streak
antigo no despacho de outro objetivo (artefato do probe, não do runtime).

| Cenário | Resultado | Snapshot da Julia (`consecutiveFailures`) |
|---|---|---|
| 1. mesmo objetivo/alvo, 3× `PATH_FAILED` | **passou** | **0 → 1 → 2** nos 3 despachos, streak **3** após a 3ª falha (visto como `cf=3` no despacho seguinte na 1ª rodada) |
| 2. streak 2, cancelar a mesma tarefa | **passou** | tarefa cancelada (`code:'CANCELLED'`, `interrupted:true`) manteve streak **2** (nem 3, nem 0); o despacho reemitido também veio com **2** |
| 3. streak 2, outro objetivo (`coal_ore`) | **passou** | snapshot do novo objetivo com **0** (payload confirma); voltar a `iron_ore` também começa em **0** |

Ruídos declarados: na 1ª rodada a 3ª falha veio `ITEM_NOT_CONFIRMED` (montagem) e a ferramenta ficou "não equipada";
o streak persiste no worker, então zerei com um sucesso antes de repetir; numa rodada limpa uma das falhas foi
`RESOURCE_NOT_FOUND` (também falha genuína do mesmo objetivo, conta). Sem erros/timeouts/inválidas/violações/abandonos
nas 12 linhas da Julia. `alternativeRoute` não foi testado.
