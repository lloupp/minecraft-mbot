# Ambiente reproduzível — Minecraft Java 1.20.1 real

Objetivo: testar o `index.js` de produção da PR #92 contra o servidor **vanilla oficial**,
em um mundo gerado naturalmente e descartável, com **dois workers** em Survival/Normal.
Não é um simulador de entidades, mock do executor nem uma cena fabricada.

## Isolamento e rastreabilidade

- O servidor e o app só escutam em `127.0.0.1`; `online-mode=false` apenas
  para identidades de teste locais. **Nunca exponha esse servidor na Internet.**
- Um servidor vanilla 1.20.1 oficial é baixado a partir dos manifests Mojang,
  validando SHA-1 e tamanho. SHA-1 fixado: `84194a2f286ef7c14ed7ce0090dba59902951553`.
  O JAR não é armazenado no Git ou nos artefatos.
- Java 21 e Node.js 22, `npm ci` e Python 3 (bibliotecas nativas do Python).
- Mundo `minecraft:normal` criado com seed configurável, sem loot, ferramentas,
  alimentos ou troncos injetados por comando. O harness inspeciona terreno firme,
  escolhe um spawn seguro, posiciona **um baú vazio a dois blocos do spawn** e
  usa duas cópias SHA-256 idênticas do mundo inicial.
- Ambos os braços executam `index.js` real: um controle com Tool API só para
  telemetria e outro com tarefas API sobre dois workers reais. A automação da
  colônia, ownership, `worker_busy`, `stop`, coleta e checkpoints são exercitados.
- Julia/Laya/modelos ficam desligados; isto mede robustez física e concorrência,
  **não** prova que uma IA já decide sozinha.

## Reproduzir em Linux/macOS

```bash
npm ci
python3 scripts/download-vanilla-server.py --version 1.20.1 --output .cache/vanilla-1.20.1.jar
MBOT_TEST_SERVER_JAR=.cache/vanilla-1.20.1.jar \
MBOT_TEST_EULA_ACCEPTED=1 \
MBOT_SOAK_SECONDS=300 \
MBOT_SOAK_SEED=42 \
MBOT_SOAK_NIGHT_MODE=natural \
MBOT_SOAK_OUTPUT_DIR="$PWD/soak-evidence-42" \
node scripts/tool-api-natural-soak.js
```

`MBOT_TEST_EULA_ACCEPTED=1` deve ser definido somente após concordar com
os termos aplicáveis ao Minecraft. Java deve estar no PATH e ser compatível
com o servidor. A pasta de evidência precisa **não existir** no início.

## Reproduzir no Windows / PowerShell

```powershell
npm ci
py -3 scripts/download-vanilla-server.py --version 1.20.1 --output .cache/vanilla-1.20.1.jar
$env:MBOT_TEST_SERVER_JAR = (Resolve-Path .cache/vanilla-1.20.1.jar).Path
$env:MBOT_TEST_EULA_ACCEPTED = "1"
$env:MBOT_SOAK_SECONDS = "300"
$env:MBOT_SOAK_SEED = "42"
$env:MBOT_SOAK_NIGHT_MODE = "natural"
$env:MBOT_SOAK_OUTPUT_DIR = "$PWD/soak-evidence-42"
node scripts/tool-api-natural-soak.js
```

## GitHub Actions

O job `Minecraft 1.20.1 natural survival (2 workers)` em
`.github/workflows/ci.yml` é executado **somente** na PR experimental #92.
É o mesmo harness real com `MBOT_SOAK_SECONDS=120` e
`MBOT_SOAK_NIGHT_MODE=accelerated`. A cada push da PR, preserva logs,
telemetria JSONL, checkpoints e relatórios, inclusive se falhar. Não exporta
o mundo nem o JAR. Consultar o job na aba *Checks* da PR #92.

## Parâmetros e limites

| Parâmetro | Valor padrão | Comportamento |
|---|---|---|
| `MBOT_SOAK_SECONDS` | 120 | 90–1800 s **por braço** |
| `MBOT_SOAK_SEED` | 42 | Seed inteira para mundo natural |
| `MBOT_SOAK_NIGHT_MODE` | `accelerated` | `accelerated` impõe noite no meio; `natural` mantém ciclo natural |
| `MBOT_SOAK_OUTPUT_DIR` | temporário | Diretório inexistente que guarda evidências |
| `MBOT_TEST_SERVER_JAR` | obrigatório | JAR vanilla 1.20.1 oficial |
| `MBOT_TEST_EULA_ACCEPTED` | obrigatório `1` | Aprovação de termos antes da execução |

As amostras de bot são registradas aproximadamente a cada 2 segundos.
`report.json` contém estado dos dois braços, hash do snapshot,
saúde/fome, tarefas, ações e assertions. `*-app.log` registra
`[estoque] container_open_failed` com informações do momento do timeout.
O relatório mede erros `pos.floored` e timeouts observados.

**Interpretação:** 120 segundos por braço + noite forçada é um **smoke físico**,
não um soak de sobrevivência natural de longa duração. Para medir dia/noite
natural e fome, execute `MBOT_SOAK_SECONDS=1800` + modo `natural`, em várias
seeds (ex.: 42, 1337, 20261019) e preserve também todos os fracassos.
A comparação compartilha estado inicial, mas o timing de mobs e rede não é
determinístico e não deve ser interpretado como experimento causal de produtividade.

## Critérios para avançar

1. CI Node, Python, Gauntlet e E2E concluídos.
2. `pos.floored` não reaparece em coleta real; nenhuma proteção de nudge
   pode ser removida para ocultar um erro.
3. Se `windowOpen` falhar, classificar a partir do snapshot físico real
   (`sneaking`, distância, obstrução, janela atual); não adicionar retry cego.
4. Depois cobrir preempção física de craft/deposit/withdraw e coleta de
   itens em múltiplas seeds, ciclo natural completo e reconexão.

Nunca mesclar a PR experimental sem evidência suficiente.
