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
  escolhe um spawn seguro, posiciona **um baú vazio em local acessível a 2–6 blocos horizontais do spawn** e
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
É o mesmo harness real com `MBOT_SOAK_SECONDS=1200`,
`MBOT_SOAK_NIGHT_MODE=natural` e `MBOT_SOAK_AUTONOMOUS=1`.
O modo é iniciado no spawn sem comando de chat do observador, com ambos
colônia e companheiro principal autônomos. A cada push da PR, preserva logs,
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

**Interpretação:** 1200 segundos por braço + ciclo natural é um **soak físico**
de 20 minutos por braço. Ainda não prova sobrevivência indefinida. Para ampliar,
execute `MBOT_SOAK_SECONDS=1800` + modo `natural`, em várias
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

## Operação autônoma contínua no Linux Mint

A CI usa mundos descartáveis: **ela não é hospedagem permanente**. Para deixar
seu próprio bot rodando enquanto o computador permanece ligado, use o
supervisor `systemd --user`, contra um servidor Minecraft seu.

```bash
git checkout test/natural-two-worker-soak-20261011
npm ci
bash scripts/install-autonomous-service.sh
nano ~/.config/minecraft-mbot/autonomous.env
systemctl --user enable --now minecraft-mbot.service
systemctl --user status minecraft-mbot.service
journalctl --user -u minecraft-mbot.service -f
```

O arquivo de ambiente cria `MBOT_COLONY_AUTOSTART=1` e
`MBOT_COMPANION_AUTOSTART=1`, com Julia/Laya sem autoridade, API externa
desligada e interfaces de rede desativadas por padrão. Reinício por
`systemd` ocorre 30 s depois de o processo terminar; se o servidor ainda
não estiver ligado, o serviço volta a tentar. Não ligue portas a
`0.0.0.0` nem use `online-mode=false` em servidor acessível pela Internet.

**Condição importante:** para a colônia iniciar por conta própria, configure
uma base, estoque e workers (o estado persistente já suporta isso). Sem
eles, o startup recusa a automação e registra explicitamente o motivo, sem
inventar ou modificar sua base. O companheiro autônomo é independente e
pode começar a explorar. Nenhum recurso do teste `E2E` é injetado no mundo
do usuário. Status do serviço só é prova de processo conectado; verifique
logs/telemetria para confirmar trabalho físico e progresso real.

Para desligar:

```bash
systemctl --user disable --now minecraft-mbot.service
```

Serviços de usuário podem parar no logout; `loginctl enable-linger`
(requer permissões administrativas) habilita permanência após logout.
O computador ou servidor precisa estar ligado; GitHub Actions não mantém
um mundo persistente 24/7.
