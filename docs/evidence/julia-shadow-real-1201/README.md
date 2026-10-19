# Julia-1 em shadow mode real — Minecraft Java 1.20.1

Julia-1 (sidecar CPU, 4 núcleos, sem GPU) observando o runtime real
(`node index.js`, perfil `vanilla1201`) num servidor vanilla 1.20.1
(`online-mode=false`, descartável). **Sem autoridade de execução**
(`executionAuthority: "none"` em todas as linhas). Laya desligado.

Arquivos: `decisions.jsonl` (log bruto), `report.json` (`npm run julia-shadow:report`).

## Testes do repositório

`npm run check` OK; `npm test` **407/407** (antes: 394/395 por uma asserção
desatualizada em `test/player-loop.test.js`, corrigida em `a4b95fd`;
`py_compile` OK).

## Resultados (22 decisões reais, 26 min de sessão, 2 workers)

| Métrica | Valor |
|---|---|
| Decisões / respondidas / descartadas | 22 / 22 / 0 |
| Latência p50 / p95 / máx | 189 / 297 / 310 ms |
| Timeouts, erros HTTP, escolhas inválidas, fora da allowlist | 0 |
| Confiança mínima | 0,87 |
| Safety violations (regra do Gauntlet V2 sobre o estado real) | 0 |
| Abandonos de objetivo (`stop_task`), injustificados | 0 / 0 |
| Interrompidas / retomadas (registradas) | 8 / 3 |
| Ação real falhou (`ok:false`, todas por interrupção/reflexo) | 8 |
| Concordância com as regras | 19/22 |
| Concordância com a tarefa real | 0/8 mapeáveis (ver abaixo) |
| RSS sidecar Julia / runtime Node | ~973 MB / ~263 MB |
| Lag do event loop com shadow ligado (>1,5 s) | 0 ocorrências |

Cenários (candidatos → escolha da Julia): ameaça com arma equipada
`fight_threat/escape_danger → fight_threat` (5); ameaça, arma no inventário
`equip_best_weapon/escape_danger → equip_best_weapon` (4) e `→ escape_danger` (1);
ameaça longe, sem arma `prepare_combat/escape_danger → prepare_combat` (3);
exploração com material `prepare_combat/continue_objective → prepare_combat` (7);
noite `return_base/prepare_combat → prepare_combat` (1);
fome (food 10) longe da base `continue_objective/return_base → return_base` (1).

## Divergências Julia × regras (3)

1. Noite, explorando: regras `return_base`, Julia `prepare_combat` (conf. 0,98).
2. Ameaça, arma no inventário: regras `equip_best_weapon`, Julia `escape_danger`
   (conta como `safetyOverride`: sob ameaça prevaleceria o reflexo determinístico).
3. Fome (food 10) longe da base: regras `continue_objective`, Julia `return_base` (0,92).

Nenhuma é insegura; todas estão dentro da máscara. "Regras" = 1º candidato, como no Gauntlet.

## Casos problemáticos / limitações (não são sucesso, são o que falta)

- **Cobertura baixa por design do estado real.** `real-state.js` não preenche
  `nearby`/`alternativeRoute`; por isso coleta, crafting, retorno simples e
  falha de rota (≥3 falhas ⇒ candidato único `stop_task`/`replan_route`)
  geram **1 candidato** e a Julia não é consultada. Esses cenários foram
  *executados* (coleta de 4 troncos verificada), mas **não há decisão da
  Julia para avaliar**. Não testei "falha de rota" com a Julia.
- Crafting/`!fabricar`/`!minerar`/`!seguir` rodam no bot principal, fora do gancho.
- `agrees_with_real = 0/8` é artefato de vocabulário: a tarefa real
  (`explorar`) mapeia para `continue_objective`, que a Julia raramente
  escolheu porque o estado oferecia `prepare_combat`.
- `loops: 2` no relatório é falso positivo do roteiro: 3 ordens idênticas
  disparadas por mim em sequência sobre o mesmo estado (linhas 4–6 e 12–14).
  Não é laço do decisor, mas o critério "0 loops" fica formalmente vermelho.
- Fome só foi observável em food 9–10 (≤8 ⇒ candidato único `return_base`).
- Uma decisão de retomada só é registrada se a reemissão tiver ≥2 candidatos.

## Bug pré-existente no runtime (independente do shadow)

Reproduzido **com o shadow desligado**: worker sem a ferramenta do papel
(ex.: `lenhador` sem machado) + `!ordem` ⇒ `ProductionManager.craftInternal`
percorre todas as variantes de receita recursivamente e cada nó chama
`findCraftingTable` → `bot.findBlock` síncrono. Medido: **lag de 72 s** no
event loop; todos os bots caem com `Timed out`. Perfil de CPU: 70,6 s em
`craftInternal`/`findCraftingTable`/`ensureIngredient`. Contornado nos testes
dando machado e mesa aos workers. **Não corrigido aqui** (fora de escopo;
deveria ir em branch própria com memoização/limite de busca).

## Conclusão

**Não pronta para autoridade limitada.** Nas 22 decisões: 0 violações de
segurança, 0 fora da allowlist, 0 abandonos, 0 erros/timeouts, p95 297 ms
(<2 s) e nenhum impacto observado no runtime real. Mas o relatório reprova:
`fewer_than_500_decisions` (22), `fewer_than_2_hours` (0,43 h) e `loops`
(falso positivo do roteiro). Além do volume, a evidência cobre só ameaça,
preparo de combate e fome; coleta, crafting, retorno e falha de rota não
geram decisão com o estado real atual. Próximo passo: enriquecer
`real-state.js` (`nearby`, `alternativeRoute`) e rodar sessão longa (≥2 h,
≥500 decisões) antes de qualquer autoridade.
