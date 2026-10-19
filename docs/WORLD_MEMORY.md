# WorldMemory — memória espacial persistente

Camada de **conhecimento** do mundo (nunca executor). O bot deixa de saber só "o que existe perto de mim agora" e
passa a lembrar onde ficam recursos, mesas, regiões já exploradas e problemas — sempre como **hipótese**:

```
perceber → lembrar → localizar → (hipótese) → chegar/perceber → confirmar no mundo → agir → atualizar a memória
```

A memória **nunca** autoriza uma ação física. Allowlist, preflight, safety, ownership e executores determinísticos
continuam exatamente como antes; a memória só decide **onde olhar**. `executionAuthority = none` para a Julia permanece.

## Arquivos

| Arquivo | Papel |
|---|---|
| `lib/world-memory.js` | Estrutura, validade, persistência, consultas (`suggest`, `chooseExploreTarget`, `suggestPreparationSite`). Sem mineflayer. |
| `lib/world-observer.js` | Percepção → memória (resumo por chunk, nunca por bloco) e **reconciliação** com o mundo real (`verifyPlace`). |
| `core/WorkerController.js` | Ganchos: `explore`, `gatherBlocks`, preparação (`tryRememberedPreparationSite`), `returnHome`, `ir_local`. |
| `index.js` | Cria uma instância **compartilhada** por todos os workers; providers de base/storage; `!mundo`. |
| `test/world-memory*.test.js`, `test/worker-world-memory.test.js` | Unitários e de integração do worker. |

## Feature flags

| Variável | Efeito |
|---|---|
| *(nenhuma)* | Nada muda; nenhum arquivo é criado. |
| `MBOT_WORLD_MEMORY=1` | **Coleta e persiste** (observa, confirma, invalida, mede). Não influencia nenhuma decisão. |
| `MBOT_WORLD_MEMORY_GUIDE=1` | (com a anterior) a memória orienta: destino de `explorar`, desvio de `coletar_blocos` quando nada está à vista, viagem única a um ponto conhecido mesa+madeira+pedra na preparação. |
| `MBOT_WORLD_MEMORY_FILE` | Caminho do arquivo (padrão `.data/world-memory.json`). |

## Schema (versão 1)

```jsonc
{
  "version": 1, "savedAt": "...",
  "places": [{
    "kind": "wood|stone|iron|coal|crafting_table|furnace|mine_entry|lava|water|drop|route_failed",
    "dim": "overworld|the_nether|the_end",
    "x": 0, "y": 0, "z": 0,            // bloco exato (landmarks) ou âncora da região (1 por chunk e tipo)
    "status": "CONFIRMED|STALE|INVALIDATED",
    "count": 1, "firstSeenAt": 0, "lastSeenAt": 0, "lastConfirmedAt": 0, "invalidatedAt": null,
    "confirmations": 0, "failures": 0, "skipUntil": 0, "by": "worker"
  }],
  "explored": [["overworld|6,0", visitedAt, visits, firstVisitedAt]],   // cobertura por chunk
  "landmarks": { "base": {"t":0,"x":0,"y":0,"z":0} },                  // só carimbos de confirmação
  "metrics": { ... }, "extra": {}
}
```

* **Identidade espacial**: toda chave inclui a dimensão. Landmarks de bloco (`crafting_table`, `mine_entry`, `furnace`)
  usam o bloco exato; recursos e hazards são **regiões de chunk** (uma âncora por chunk/tipo, não um registro por bloco).
* **Base e storage não são duplicados**: continuam no `WaypointManager`/`StorageManager`. A memória lê por *providers*
  e persiste só o carimbo de última confirmação (`landmarks`).
* **Validade**: `CONFIRMED` envelhece para `STALE` por tipo (mesa/forno 6 h, `mine_entry` 12 h, recursos 2 h, hazards 24 h).
  `STALE` continua servindo como hipótese de menor prioridade (CONFIRMED vence STALE mesmo mais longe).
  `INVALIDATED` nunca é sugerido; re-observação restaura. Tombstones expiram em 7 dias.
* **Limites**: 512 places (evicta INVALIDATED, depois STALE/mais antigos) e 4096 chunks explorados.

## Persistência

JSON em arquivo próprio (não acoplado ao `colony-state`), escrita **atômica** (tmp + rename), serializada por cadeia de
promises, *debounced* (2 s) e só em eventos significativos (lugar novo/mudança de status, chunk novo). `flushSync` em
`exit`/SIGINT/SIGTERM. Arquivo ausente → vazio; JSON corrompido → renomeado para `*.corrupt-<ts>` e começa vazio;
entradas inválidas são descartadas uma a uma; **versão futura → somente leitura, arquivo nunca sobrescrito**.

## Como a memória é usada (sempre com confirmação física)

| Fluxo | Uso | Confirmação |
|---|---|---|
| `explorar` | `chooseExploreTarget` escolhe, entre os pontos do anel clássico, o de menor custo (distância + chunk visitado recentemente + hazards/`route_failed`). Memória vazia ⇒ padrão clássico. | `visit` ao chegar e durante a caminhada; `route_failed` se o pathfinder falhar. |
| `coletar_blocos` | Só quando **nada** está à vista (`RESOURCE_NOT_FOUND`): até 2 hipóteses do tipo de recurso. | `approachRemembered` → `verifyPlace` no mundo real; só então o mesmo `mineBlocks` de sempre. Ausência ⇒ `INVALIDATED` (sem loop); caminho impossível ⇒ cooldown crescente, sem invalidar. |
| Preparação | Ponto conhecido mesa+madeira+pedra; **uma** viagem por tarefa, depois do staging local. | Chegou ⇒ `verifyPlace` da mesa ⇒ o loop recomeça com snapshot real, allowlist e preflight. |
| Base | `returnHome` confirma o landmark `base`. | posição real ≤ 6 blocos. |

Safety continua vencendo: nada disso roda fora do owner da tarefa; ameaça/cancelamento incrementam `taskVersion` e
interrompem a caminhada como antes.

## Logs e métricas

`[world-memory] discover|confirm|invalidate|suggest|explored …` (um por evento, nunca por bloco; chunks agregados por
varredura). `!mundo` imprime o resumo. Métricas persistidas: `created`, `confirmed` (transições), `verified`
(conferências físicas OK), `invalidated`, `queries`, `usefulQueries` (sugestão depois confirmada), `staleQueries`
(sugestão depois invalidada), `exploredChunks`, `exploreChoices`, `exploreRepeats` (destino em chunk visitado nos
últimos 30 min — medido também com a flag `GUIDE` desligada, para comparação).

## Evidência

Ver `docs/evidence/world-memory-1201/README.md`.
