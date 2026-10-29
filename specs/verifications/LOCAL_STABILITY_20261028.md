---
type: verification
context: local-stability-pr-review-20261028
---
# Revisão incremental da instalação local

## Resultado

Validação parcial no jogo, com coleta e depósito de madeira confirmados. Não é certificação de autonomia completa. Sem merge na main, push, reinício do servidor ou autoridade de execução para modelos.

## Preservação e PRs

Baseline `9329e13`; segurança `safety/local-before-pr-review-20261028`; trabalho `feat/local-stability-pr-review`. Backup privado fora do repositório descrito em `specs/LOCAL_STABILITY_PLAN.md`: não publicar, pois contém configuração e estado. Comparação binária com o ZIP confirmou `.env` e os três launchers idênticos.

Mantidos Forge, workers/papéis, memória espacial, coleta/mineração/crafting, combate, alimentação, cama/abrigo noturno, projetos/construções/plantas, dashboard, câmera 3D com teclado, fila e política de ferramentas/equipamentos mais reserva de comida. Preservação de código não equivale a nova validação física de todas as funções.

| PR / head consultada | Adaptação seletiva |
| --- | --- |
| #89 / ac629e0 | Corpus/benchmark offline com gate NEUTRAL. Sem datasets históricos importados ou execução por embeddings. Memória local preservada. |
| #93 / 81869ac | ONLY/SKIP e probe de seis plugins existentes; AutoEat local preservado; sem novo controlador de movimento. |
| #95 / a8047eb | Alimentação de worker ferido; depósito de ferro somente ocioso; conexão validada; cerca completa e blocos verificados; testes portáveis/limitados. Não reintroduzida reserva de ferro bruto no inventário. |
| #96 / 12fdcbd | Aliases e catálogo de minerais por registro/dimensão, incluindo modificados. Não importado scheduler prioritário draft concorrente. Catálogo não autoriza viagens ao Nether. |
| #97 / 3f4b6ce | Revisados API opt-in e reservas; endurecida fila local sem importar dispatcher concorrente sem arbitragem global. API existente preservada. |

## Correções

- RequestQueue serializa gravações, desfaz inserção/cancelamento se persistência falhar e reserva worker até salvar resultado. Falha ao salvar resultado impede novo despacho até recuperação. Reinício interrompe tarefa em andamento, sem repetição automática.
- Estoque só recuperado perto do endereço central, após observação carregada. Até três posições locais, cancelamento e confirmação do bloco. Crafting usa receita disponível e mesa observada próxima; não inicia coleta remota durante recuperação.
- Reserva alimentar é orçamento total de oito unidades entre pilhas; ferramentas/equipamentos preservados.
- Madeira visível e ao alcance usa raycast existente antes de exigir posição adjacente. Alvos ocluídos continuam exigindo navegação.
- Comandos npm passaram a usar o runtime que iniciou o npm, sem shell/glob dependente da plataforma. Nesta instalação o shim local de Node 19.8.1 fazia as verificações travarem; launcher preservado.

## Automatizados executados

- Baseline JavaScript: 724 aprovados.
- `npm run check`: sintaxe válida em 90 arquivos do escopo do verificador.
- `npm test` final: **764/764**, sem falhas/cancelamentos/skips.
- `npm run plugin:probe`: **6/6** (pvp, custompvp, tool, collectblock, hawkeye, autoeat).
- `python -m unittest discover -s test -p 'test_*sidecar.py'`: **13/13**.
- `node scripts/player-loop-gauntlet-v2.js`: **60 cenários determinísticos**, success_rate=1; zero violações, loops, escolhas inválidas ou chamadas de modelo.
- Regressão de madeira visível reproduzida antes do ajuste e aprovada depois, incluindo caso negativo ocluído.
- `git diff --check`: sem erros de whitespace; aviso local LF/CRLF.

## Testes reais: 192.168.0.74:25567

Launcher existente com estado de smoke separado e overrides de sessão para desativar automação de colônia/companheiro, projetos e lotes de ferro; `.env` não modificado. Modelos sem autoridade.

### Fase 1

Main e cinco workers conectaram. Dashboard/status respondeu. Ordem `60d26970-7721-414e-8f03-a0840710e5ac` falhou com PATH_FAILED, gathered=0, deposited={}. Alimentação não recuperada: snapshot main HP=19, fome=6. `!estoque guardar` encontrou recusa de colocação pelo servidor e falhas de navegação do minerador/artesão. Nenhum depósito de ferro comprovado. Encerramento intencional por `!parar`, exit 0.

### Fase 2, após os ajustes

Estado parado restaurou sem workers; comandos enviados antes da recriação não provaram execução. Criado apenas lenhador_01 explicitamente com `!bot criar lenhador 1`.

Pedido **d0e9f48b-497e-428d-831b-30c42cddbe35** persistido em revisao: ok=true, verified=true, gathered=1, requested=1. Duas tentativas PATH_FAILED seguidas de **visible_in_reach, delta=1, itemConfirmed=true**.

Container recuperado em **-92,65,-47**. O log não distingue isoladamente criação nesta operação de redescoberta após operação anterior. Retorno persistido das transferências de depósito:

```text
acacia_log:1, acacia_sapling:13, gravel:5, acacia_fence:2,
cornflower:1, cobblestone:80, granite:8, coal:14,
oak_planks:2, stick:2, crafting_table:1
```

Coleta física e transferências de carga confirmadas pelas operações. Não houve segunda leitura independente do conteúdo do baú após transferência; manter revisao é intencional. Janela encerrada pelo timeout do harness em 600 segundos: não confundir com crash do bot nem declarar processo ainda rodando.

Evidências locais não versionadas: `.data/stability-smoke-state.json`, `logs/stability-live-*.json`, `logs/stability-final-tests.log`, `logs/stability-python-tests.log`, `logs/stability-gauntlet.log`, `logs/bot-run.log`.

## Pendências

1. Navegação ainda apresenta PATH_FAILED/timeouts; o fallback resolveu uma coleta, não todos os caminhos.
2. Alimentar o main; última fome medida 6/20.
3. Confirmar minério no baú: os 21 raw_iron vistos anteriormente no minerador não têm entrega comprovada nesta revisão.
4. Validar cama, combate, crafting amplo e construção no jogo. Cerca agora recusa perímetro incompleto/desnivelado; não nivela terreno.
5. Somente !ordem usa a fila persistente. !construir e outros fluxos não têm arbitragem global e podem interromper trabalho. Não ligar schedulers concorrentes experimentais.
6. Histórico da fila sem pruning, embora existam no máximo 100 pedidos ativos.
7. Sem revisão independente por outro agente. Autoauditoria/testes não a substituem.

## Inicialização preservada

```text
node iniciar-bot.js --supervise
```

Alternativa: `iniciar-bot-supervisionado.cmd`. Lançamento normal usa configuração e estado originais, não o estado isolado dos testes; revisar pendências antes de automação irrestrita.

## Autoauditoria

PASS: sem dependências novas; configuração privada fora do commit; novos subprocessos sem shell; limites de tentativas/quantidade/tempo; sucesso físico não inferido de aceitação HTTP. Testes negativos cobrem cancelamento, estoque ausente/distante, falha de gravação, alvo ocluído e colocação não confirmada. Arquivos legados grandes não foram reestruturados para não ampliar risco. Segurança revista somente no delta, não em todas as dependências/servidor.
