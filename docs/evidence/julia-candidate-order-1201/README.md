# Julia-1: neutralização da ordem upstream — Minecraft Java 1.20.1

Data: 2026-09-30. PR #78; branch `experiment/julia-laya-andy-player-loop-v2`.
HEAD medido: `43804aba48bce37fad5c23e39e403ef195dc946b`.

**Resultado principal: passou. Diferenças por ordem upstream = 0/22 pares.**
Todas as 44 chamadas medidas tiveram HTTP 200, uma inferência real, mesma escolha
e probabilidades exatamente iguais dentro de cada par (diferença máxima absoluta = 0).
Não houve erros ou timeouts. Nenhum benchmark longo foi executado.

## Validação inicial e escopo

Executados na ordem solicitada: `git checkout experiment/julia-laya-andy-player-loop-v2`,
`git pull` (already up to date), `npm run check`,
`python -m py_compile scripts/julia-decision-server.py`,
`python -m unittest discover -s test -p 'test_julia_sidecar.py'` (2/2).
Depois: `node --test test/julia-shadow.test.js` (6/6, log incluído).
A suíte completa não faz parte desta rodada; este resultado não estabelece condição de merge.

Nenhum arquivo de produção, descrição, guardrail ou regra de decisão foi alterado.
Julia somente em shadow mode, `executionAuthority: "none"`, sem Laya/Andy/NanoAndy.
`main` não foi alterada; não foi feito merge.

## Método e captura efetiva

Servidor vanilla Java **1.20.1**, Java 17.0.20, mundo isolado de teste, plataforma
de terra em y=199; modo survival, dificuldade peaceful, dia fixo, sem geração de mobs.
O cliente Mineflayer 4.42.2 conectou-se como `order_probe`.

Para cada estado, o driver captura `realStateSnapshot()` do cliente real e gera os
candidatos com `candidateIntents()` do HEAD medido. Congela esse estado e o conjunto
completo de candidatos, inclusive descrições, e observa duas vezes:

- A recebido pelo sidecar: `gather_materials`, `continue_objective`.
- B recebido pelo sidecar: `continue_objective`, `gather_materials`.
- A e B efetivamente apresentados à Julia: **`continue_objective`, `gather_materials`**.

A captura `CaptureEngine.predict()` envolve o engine real carregado pelo sidecar
de produção, sem substituir inferência ou alterar seus argumentos. Registra a string
exata de estado, `questions.intent.criteria` na ordem de inserção, SHA-256 do input
serializado e saída bruta de `engine.predict()`. O sidecar continua usando o `choose()`
original. O par só passa se o payload normalizado completo, não apenas a lista de IDs,
for idêntico. Saída bruta também idêntica em **22/22 pares**.

O harness chama `JuliaShadowObserver.observe()`, verifica retorno `undefined` e nunca
aplica uma escolha ao jogo. O resultado da observação é um marcador sintético
`observationOnly`, não uma tarefa de coleta/mineração executada. A sessão real valida
captura de estado, contrato, normalização e inferência em shadow; não testa desempenho
de um executor de coleta. A e B usam o mesmo snapshot, sem recaptura entre chamadas.

## Pares no servidor real

Cinco estados por objetivo; vida/comida 20, sem ameaça, base conhecida a 299,5 blocos,
sem arma/falhas, `alternativeRoute=false`. `explore`: inventário vazio;
`mine_iron`: uma `stone_pickaxe`, equipada. Estes controles correspondem aos estados
anteriores de gather, com descrições atuais após a reversão do enriquecimento.

| Par por objetivo | Recursos observados | Distâncias (blocos) | Explore: escolha A = B | Mine iron: escolha A = B |
|---|---|---|---|---|
| 1 | madeira + pedra | 2 / 2 | continue_objective | continue_objective |
| 2 | madeira + pedra | 5,657 / 5,657 | continue_objective | continue_objective |
| 3 | madeira | 2 | continue_objective | continue_objective |
| 4 | pedra + ferro | 2 / 2 | continue_objective | gather_materials |
| 5 | madeira + pedra + ferro | 4 / 4 / 4 | continue_objective | continue_objective |

**10/10 pares passaram**, 20/20 chamadas válidas. Os blocos foram configurados via
console, e `nearby` veio da amostragem limitada do bot real.

## Varredura offline curta

Seis estados por objetivo, derivados do primeiro snapshot real de cada objetivo.
Combinações `{wood}`, `{wood, stone}`, `{wood, stone, iron}` × distâncias **2 e 6**.
Somente os campos de presença/distância de materiais em `nearby` mudam entre estados;
cada estado é executado nas duas ordens upstream, sempre com as descrições de produção.

**12/12 pares passaram**, 24/24 chamadas válidas; diferenças por ordem upstream **0**.
Tolerância absoluta predefinida no sumarizador: `1e-7`; o delta observado foi **0**.

## Frequência comportamental — análise separada

Este resumo descreve escolhas e não avalia se `gather_materials` era correto.
Cada estado foi contado duas vezes, uma por ordem; isso não são amostras independentes.

| Objetivo | Servidor: chamadas gather | Servidor: estados gather | Offline: chamadas gather | Offline: estados gather |
|---|---|---|---|---|
| explore | 0/10 (0%) | 0/5 | 0/12 (0%) | 0/6 |
| mine_iron | 2/10 (20%) | 1/5 | 2/12 (16,7%) | 1/6 |

Em `mine_iron`, gather ocorreu no servidor com pedra+ferro a 2 blocos (P=0,688115)
e offline com madeira+pedra+ferro a 6 blocos (P=0,529548).
Nenhuma regra comportamental foi implementada; a decisão sobre o próximo passo fica separada
da conclusão de que a ordem upstream foi neutralizada neste teste.

## Ambiente e latência

Julia oficial `SupersonicLabs/Julia-1`, código e pesos fixados no snapshot
`a85b127321d580d65176c89ced8273f305745d85`, 577.189.056 bytes de pesos.
Instalação via Git falhou (`expected packfile`); os mesmos arquivos do snapshot foram
baixados por HTTPS, instalados localmente e usados com `JULIA_MODEL=<diretório>`.
Inferência CPU, Python 3.12.14, torch 2.14.1+cpu, transformers 5.0.0.
O runtime oficial define **4 threads** após o load, conforme captura; env OMP/MKL=2.
Dependências Mineflayer existentes reutilizadas; versão de `minecraft-data` 3.111.6.

Uma chamada real de warm-up separada (235,680 ms) foi excluída das 44 medições.
Latência do sidecar: mediana **196,024 ms**, p95 por nearest rank **242,767 ms**,
mínimo **145,966 ms**, máximo **248,844 ms**. Timeout shadow: 4 s.
Servidor e sidecar foram encerrados ao final. São resultados de uma sessão CPU
controlada; não estabelecem determinismo universal em outros runtimes/dispositivos.

## Evidência e reprodução

- `pairs.csv`: linha por chamada com estado, ordens, probabilidades, escolha,
  confiança, latência, HTTP, erros/timeouts e hash normalizado.
- `requests.jsonl`: pares A/B, snapshots, candidatos completos, contexto do mundo
  e eventos shadow; `shadow.jsonl`: observações sem autoridade.
- `sidecar-traces.jsonl`: entrada upstream, payload exato pós-normalização e saída
  bruta da Julia, incluindo warm-up identificado separadamente.
- `summary.json`: gate por par, diferenças e frequência separada, gerado por `summarize.py`.
- `minecraft.log`, `minecraft-commands.json`, `driver.log`, `sidecar.log`,
  `runtime-environment.json`, `requirements-resolved.txt`, `input-checksums.txt` e `warmup.json`.

Para repetir, prepare um diretório isolado com `server.jar`, bibliotecas Java 1.20.1
e EULA aceita, o snapshot Julia fixado e um venv com as dependências registradas.
Use dependências Node do projeto. O driver configura um mundo próprio, inicia e encerra
ambos os serviços; portas 25566/8768 precisam estar livres. Informe um destino novo
para preservar esta evidência:

```bash
ORDER_SERVER_DIR=/tmp/novo-minecraft-1201 \
ORDER_PYTHON=/caminho/venv/bin/python \
JULIA_MODEL=/caminho/Julia-1 \
ORDER_OUTPUT_DIR=/tmp/nova-evidencia-ordem \
node docs/evidence/julia-candidate-order-1201/run.js

ORDER_OUTPUT_DIR=/tmp/nova-evidencia-ordem \
python docs/evidence/julia-candidate-order-1201/summarize.py
```

O único ajuste posterior à execução no harness foi permitir esse destino de saída
separado e impedir sobrescrita/acréscimo sobre evidência existente; não muda inferência
ou estados medidos.
