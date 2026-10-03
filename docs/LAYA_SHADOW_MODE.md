# Shadow mode do Laya

Esta etapa liga o Laya ao runtime real do bot **só como observador**. Ele
nunca escolhe o que o bot faz, nunca bloqueia o loop de tarefas, e uma falha
dele (timeout, sidecar fora do ar, resposta inválida) nunca afeta o bot.

## Status

Implementado:

- `lib/laya-shadow.js`: o observador assíncrono (fire-and-forget, com limite
  de concorrência, disjuntor e log limitado);
- `lib/real-state.js`: traduz o bot real para o mesmo formato de estado do
  Gauntlet V2 (`lib/player-loop.js`), best-effort;
- `core/WorkerController.js`: em cada `run(task)`, se o shadow mode estiver
  ligado e houver mais de uma opção plausível, observa em paralelo;
- `scripts/laya-shadow-report.js` (`npm run shadow:report`): lê o log e
  calcula os critérios mínimos de promoção.

Ainda **não** implementado (fora do escopo desta etapa, de propósito):

- nada aqui decide ou executa ações reais — ver "Garantias de segurança"
  abaixo;
- o mapeamento de estado real ainda é aproximado (ver "Limitações
  conhecidas").

## Como ativar

```bash
MBOT_LAYA_SHADOW=1 LAYA_PLAYER_LOOP_URL=http://127.0.0.1:8765/choose npm start
```

Ou no `.env`:

```
MBOT_LAYA_SHADOW=1
LAYA_PLAYER_LOOP_URL=http://127.0.0.1:8765/choose
```

O sidecar (`scripts/laya-decision-server.py`) precisa estar rodando e
servindo `/choose` (ver `docs/LAYA_DECISION_ENGINE.md`).

## Como desativar

- Não defina `MBOT_LAYA_SHADOW` (ou defina como qualquer valor diferente de
  `1`) — é o padrão, nada muda no bot.
- Em runtime já ligado, reiniciar sem a variável (ou com `MBOT_LAYA_SHADOW=0`)
  desliga de novo. Não há chave "ao vivo" ainda: desligar exige reiniciar o
  processo, o que é intencional nesta fase experimental.

## Garantias de segurança (valem mesmo com o shadow mode ligado)

- `LayaShadowObserver.observe()` nunca retorna nada que o chamador usa —
  sempre `undefined`. Não há como o Laya "vencer" e virar a ação executada.
- `observe()` nunca é `await`ado por quem chama: dispara o trabalho e volta
  na hora. Um sidecar lento não atrasa nenhuma tarefa real do bot.
- No máximo `LAYA_SHADOW_MAX_CONCURRENT` (padrão 1) chamadas ao Laya em voo
  ao mesmo tempo; o resto é descartado (nunca enfileirado), para não acumular
  memória nem sobrecarregar o sidecar.
- Um disjuntor abre depois de `LAYA_SHADOW_BREAKER_THRESHOLD` falhas seguidas
  (padrão 5) e para de tentar por `LAYA_SHADOW_BREAKER_COOLDOWN_MS` (padrão
  60 s). Um sidecar fora do ar não vira um martelo de requisições.
- Timeout de `LAYA_SHADOW_TIMEOUT_MS` (padrão 3 s) por chamada.
- Todo erro (rede, timeout, resposta malformada, escolha fora da máscara) é
  capturado e vira um registro de falha no log — nunca uma exceção que sobe
  para o runtime.
- O log usa o mesmo `EventLog` já usado pelo resto da colônia
  (`lib/event-log.js`): tamanho e nº de linhas limitados, com rotação
  automática. Não cresce sem limite.

## O que é registrado por decisão

Arquivo `LAYA_SHADOW_LOG` (padrão `.data/laya-shadow.jsonl`), um objeto JSON
por linha, tipo `laya_shadow_decision`:

| campo | significado |
|---|---|
| `time` | quando a linha foi gravada (campo padrão do `EventLog`) |
| `decidedAt` | quando a decisão foi tomada (antes de chamar o Laya) |
| `worker` | nome do bot worker |
| `state` | retrato resumido do estado real no momento da decisão |
| `objective` | a tarefa real que o sistema já tinha decidido rodar |
| `candidates` | intenções plausíveis que o Laya viu (vocabulário do Gauntlet V2) |
| `layaChoice` | o que o Laya escolheu, ou `null` se a chamada falhou |
| `layaAttemptedChoice` | a escolha que ele deu mas que não batia com nenhum candidato (diagnóstico) |
| `layaConfidence` | confiança relatada pelo Laya, quando disponível |
| `layaError` | motivo da falha (`timeout`, `http_5xx`, `invalid_choice`, `malformed_response`, mensagem de erro de rede) |
| `latencyMs` | latência da chamada ao Laya |
| `executedChoice` | o `task.type` real que o bot executou (vocabulário do runtime, **não** o mesmo vocabulário de `candidates` — ver limitação abaixo) |
| `result` | o resultado real da tarefa, quando ela termina |
| `nextState` | novo retrato do estado, tirado quando o resultado chega |
| `interrupted` | `true` se uma tarefa mais nova substituiu esta antes dela terminar |

Descartes (disjuntor aberto ou limite de concorrência atingido) viram uma
linha mais leve, tipo `laya_shadow_skip`, com só o motivo — para a
disponibilidade calculada pelo relatório não ficar cega a eles.

## Limitações conhecidas (documentadas para não passar confiança falsa)

- **Vocabulário diferente.** `candidates`/`layaChoice` usam o vocabulário do
  Gauntlet V2 (`gather_materials`, `escape_danger`, `continue_objective`...);
  `executedChoice` é o `task.type` real da colônia (`coletar_blocos`,
  `explorar`, `voltar`...). Não há um `agree`/comparação direta no log: os
  dois vocabulários não se traduzem 1:1 nesta primeira iteração. O log serve
  para ler o julgamento do Laya sobre o estado de sobrevivência ao lado do
  que a colônia realmente fez, não para medir "concordância" automaticamente.
- **Estado aproximado.** `lib/real-state.js` não escaneia o mundo para
  `nearby` (comida/madeira/pedra por perto): esse campo fica sempre `{}`.
  `alternativeRoute` e `waitReason` ficam sempre neutros. Isso significa que
  alguns ramos de `candidateIntents` (os que dependem de recursos por perto)
  nunca aparecem nesta fase — o shadow mode observa principalmente decisões
  de sobrevivência/preparo (fome, ameaça, equipamento, base), não todo o
  espectro de decisões que o Gauntlet testa.
- **`resumed` não é derivado.** O runtime atual não expõe retomada de
  objetivo interrompido na granularidade que o Gauntlet V2 usa; o campo não
  é fabricado — fica de fora do registro nesta iteração.

## `npm run shadow:report`

Lê o log e calcula os critérios mínimos para uma futura promoção (ainda
**não** implementada — isto só analisa o que já foi observado):

```bash
npm run shadow:report
# ou
LAYA_SHADOW_LOG=.data/laya-shadow.jsonl MBOT_SHADOW_REPORT_OUT=.data/laya-shadow-report.json npm run shadow:report
```

Critérios (`promotion_readiness.reasons` lista os que faltam):

- pelo menos 500 decisões reais observadas;
- pelo menos 2 horas acumuladas (do primeiro ao último `decidedAt`);
- 0 decisões críticas inseguras (ameaça presente + Laya teria ignorado o
  perigo, lutado desarmado, ou lutado um creeper de perto — mesma regra de
  segurança já validada pelo Gauntlet V2, `lib/player-loop.js` `applyIntent`,
  rodada aqui offline sobre o estado já registrado);
- 0 escolhas fora da máscara de candidatos;
- 0 loops atribuíveis ao decisor (mesma decisão e estado se repetindo 3+
  vezes seguidas para o mesmo worker);
- disponibilidade ≥ 98% (chamadas bem-sucedidas / (chamadas + descartes));
- p50/p95 de latência são sempre registrados (sem limite fixo cobrado nesta
  fase — só a decisão de promoção olha para eles, se um limite for definido
  depois).

Passar neste relatório **não dá controle ao Laya automaticamente** — é só o
dado que a próxima decisão (humana) usaria para avaliar isso.
