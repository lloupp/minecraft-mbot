# Laya como decision model do minecraft-mbot

Esta etapa prepara e valida a integração do Laya **antes** de colocá-lo no
runtime real do bot.

## Status desta branch

Implementado:

- serviço local Laya em Python;
- cliente Node para o endpoint Laya;
- suporte do `DecisionCoordinator` ao engine `laya`;
- validação de ações contra `availableActions`;
- fallback determinístico em erro, timeout ou ação inválida;
- Laya incluído no Minecraft Decision Gauntlet;
- CI verifica sintaxe e protocolo do sidecar Python sem baixar os pesos.

Ainda **não** implementado nesta branch:

- `index.js` não instancia o `DecisionCoordinator`;
- o loop real da colônia ainda não entrega decisões ao Laya;
- definir `MBOT_DECISION_ENGINE=laya` sozinho **não muda o comportamento do bot**.

Isso é intencional. Primeiro validamos o modelo em estados de Minecraft sem
permitir efeitos no mundo. A próxima fase será shadow mode no runtime real.

## Arquitetura preparada

```
Minecraft state + objetivo
        ↓
candidatos preparados/validados pelo Node
        ↓
Laya (choice direto)
        ↓
ID de uma ação já permitida
        ↓
DecisionCoordinator
        ↓
fallback determinístico se necessário
```

O modelo não gera argumentos de ferramentas. Ferramentas e argumentos continuam
sendo preparados pelo código determinístico.

A integração usa o padrão que teve melhor comportamento no laboratório
VizDoom: uma única pergunta `choice` sobre ações mutuamente exclusivas, sem
`survival_priority`, gates Boolean ou threshold calibrado no benchmark.

## 1. Preparar o serviço local

Python 3.11+:

```bash
python -m venv .venv-laya
source .venv-laya/bin/activate
python -m pip install -r scripts/requirements-laya.txt
```

Windows PowerShell:

```powershell
py -m venv .venv-laya
.\.venv-laya\Scripts\Activate.ps1
python -m pip install -r scripts/requirements-laya.txt
```

## 2. Iniciar o Laya

Linux/macOS:

```bash
USE_TF=0 python scripts/laya-decision-server.py
```

PowerShell:

```powershell
$env:USE_TF="0"
python scripts/laya-decision-server.py
```

Na primeira inicialização, o Router pode precisar baixar/carregar o checkpoint.
O processo faz um **warm-up antes de abrir a porta HTTP**, justamente para que a
primeira decisão real não estoure o timeout do cliente. Aguarde aparecer:

```text
Laya decision service listening on http://127.0.0.1:8765/decision
```

Somente depois dessa mensagem o serviço está pronto para o Gauntlet.
`LAYA_SKIP_WARMUP=1` existe apenas para testes de protocolo; não use no
benchmark real.

Por padrão:

- host: `127.0.0.1`;
- porta: `8765`;
- health: `http://127.0.0.1:8765/healthz`;
- decision: `http://127.0.0.1:8765/decision`.

O `Router` escolhe o checkpoint apropriado. Não é forçado o checkpoint
especialista `typed-decisions`.

## 3. Rodar o Minecraft Decision Gauntlet

Em outro terminal:

Linux/macOS:

```bash
LAYA_DECISION_URL=http://127.0.0.1:8765/decision npm run gauntlet:decision
```

PowerShell:

```powershell
$env:LAYA_DECISION_URL="http://127.0.0.1:8765/decision"
npm run gauntlet:decision
```

O Gauntlet compara o Laya ao baseline determinístico sem executar ações no
servidor Minecraft.

Critérios mínimos antes da próxima fase:

- zero ações inválidas;
- zero crashes;
- observar explicitamente decisões de segurança como fome, creeper,
  cancelamento e tarefa bloqueada;
- latência registrada;
- revisar divergências contra as regras em vez de assumir que discordância é
  automaticamente erro.

## Próxima fase

Depois de validar o Gauntlet, o próximo PR deve ligar o Laya em **shadow mode**
ao `ColonyOrchestrator`: o modelo observa estados e candidatos reais e seus
resultados são logados, mas o plano determinístico continua sendo executado.

Somente depois dessa evidência runtime deve existir uma opção para o Laya
selecionar a ação executada.

## Segurança já implementada

- ações desconhecidas são rejeitadas;
- ação fora de `availableActions` é rejeitada;
- timeout, HTTP error ou inference error causam fallback determinístico;
- candidatos e argumentos são preparados fora do modelo;
- serviço em localhost por padrão;
- threshold Laya desativado por padrão;
- nenhuma integração automática com o mundo nesta fase.

## Variáveis

```text
# Usadas pelo cliente/benchmark e reservadas para a fase runtime.
MBOT_DECISION_ENGINE=deterministic|conversa-llm|laya
LAYA_DECISION_URL=http://127.0.0.1:8765/decision
LAYA_DECISION_TIMEOUT_MS=4000
LAYA_DECISION_THRESHOLD=
LAYA_DECISION_HOST=127.0.0.1
LAYA_DECISION_PORT=8765
```
