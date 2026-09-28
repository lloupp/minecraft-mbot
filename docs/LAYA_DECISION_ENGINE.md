# Laya como decision model do minecraft-mbot

Esta integração é **opt-in**. O comportamento padrão do bot continua
determinístico.

## Arquitetura

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
tool + args previamente preparados
        ↓
MinecraftToolLayer
```

O modelo **não gera argumentos de ferramentas**. Ele escolhe apenas entre IDs
de ações preparados pelo código determinístico.

A integração usa o padrão que teve melhor comportamento no laboratório
VizDoom: uma única pergunta `choice` sobre ações mutuamente exclusivas,
sem `survival_priority`, gates Boolean ou threshold calibrado no benchmark.

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

```bash
USE_TF=0 python scripts/laya-decision-server.py
```

Por padrão:

- host: `127.0.0.1`
- porta: `8765`
- health: `http://127.0.0.1:8765/healthz`
- decision: `http://127.0.0.1:8765/decision`

O `Router` escolhe o checkpoint apropriado. Não é forçado o checkpoint
especialista `typed-decisions`.

## 3. Rodar primeiro o Minecraft Decision Gauntlet

Em outro terminal:

```bash
LAYA_DECISION_URL=http://127.0.0.1:8765/decision \
npm run gauntlet:decision
```

O Gauntlet compara Laya com o baseline determinístico sem executar ações no
servidor Minecraft.

## 4. Ativar o engine

Somente depois de validar o Gauntlet:

```bash
MBOT_DECISION_ENGINE=laya \
LAYA_DECISION_URL=http://127.0.0.1:8765/decision \
node index.js
```

`LAYA_DECISION_THRESHOLD` é opcional e fica desativado por padrão. Não defina
um threshold apenas com base nos resultados do benchmark.

## Segurança

- ações desconhecidas são rejeitadas;
- ação fora de `availableActions` é rejeitada;
- timeout, HTTP error ou inference error causam fallback determinístico;
- candidatos e argumentos são preparados fora do modelo;
- o serviço fica em localhost por padrão;
- o modo padrão do bot continua `deterministic`.

## Variáveis

```text
MBOT_DECISION_ENGINE=deterministic|conversa-llm|laya
LAYA_DECISION_URL=http://127.0.0.1:8765/decision
LAYA_DECISION_TIMEOUT_MS=4000
LAYA_DECISION_THRESHOLD=
LAYA_DECISION_HOST=127.0.0.1
LAYA_DECISION_PORT=8765
```
