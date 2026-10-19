# Evidência de alvo alternativo do `gather` — 1.20.1

HEAD `1ed80a3`, Julia-1 só em shadow (`executionAuthority:"none"`, `alternativeRoute` sempre `false`).
`npm run check` OK; `node --test test/gather.test.js` 11/11. Nenhum código alterado.

Método: `minerador_01` numa plataforma no céu; `!ordem minerador iron_ore 1`. Alvo 1 = minério **exposto flutuando**
(inalcançável, mais perto); alvo 2 = minério aberto (alcançável, mais longe); posições novas a cada repetição
(o gather "lembra" alvos inalcançáveis por 10 min). Dados: `probe-dispatch.jsonl` (`evidence[]` completo).

| Rep | Tentativa 1 (alvo flutuante) | Tentativa 2 |
|---|---|---|
| 1* | `PATH_FAILED`, `candidateCount=3`, `observed=true`, `count=2` | `itemConfirmed=true` (alvo aberto) |
| 2 | `PATH_FAILED`, `candidateCount=2`, `observed=true`, `count=1` | `itemConfirmed=true` |
| 3 | `PATH_FAILED`, `candidateCount=2`, `observed=true`, `count=1` | `itemConfirmed=true` |
| 4 | `PATH_FAILED`, `candidateCount=2`, `observed=true`, `count=1` | `itemConfirmed=true` |

\* havia um 3º minério, sobra de testes anteriores (removido antes das reps 2–4); só a contagem difere.
Em todas: `ok:true`, `gathered:1` na **mesma ordem**. Na tentativa 2 o alvo falho já é pulado
(`candidateCount=1`, `observed=false`), como esperado.

**Controle (2 repetições, um único minério):** 1 tentativa, `candidateCount=1`, `alternateTargetCandidateObserved=false`,
`alternateTargetCandidateCount=0`, `itemConfirmed=true`.

Padrão consistente: `PATH_FAILED` → outro candidato observado → outro alvo com `itemConfirmed=true`. Ressalva: o campo
só diz que **existia** outro candidato no raio na hora da falha; a alcançabilidade foi provada pelo `itemConfirmed` da
tentativa seguinte, não pelo campo. 6 linhas da Julia: 0 erros/inválidas/violações/abandonos.
