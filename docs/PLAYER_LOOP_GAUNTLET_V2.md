# Minecraft Player Loop Gauntlet V2

Objetivo: testar o Laya como um jogador que reavalia continuamente o estado,
em vez de classificar uma decisão isolada.

## Modelo mental

```text
perceber
  ↓
segurança imediata
  ↓
necessidades
  ↓
equipamento/capacidades
  ↓
objetivo atual
  ↓
escolher uma intenção
  ↓
executor determinístico
  ↓
verificar resultado
  ↓
novo estado
  ↺
```

O modelo não controla movimento por tick, mira, crafting de baixo nível ou
argumentos de ferramentas.

## O que fica fora do modelo

Reações óbvias e críticas são determinísticas:

- creeper muito próximo;
- vida crítica sob ameaça;
- cercado por múltiplos inimigos;
- fogo/afogamento;
- cancelamento explícito;
- fome crítica quando já existe comida no inventário.

Esses casos geram um único candidato e não consomem chamada do modelo.

## O que o Laya decide

Quando existem alternativas razoáveis, o Laya escolhe uma intenção estratégica,
por exemplo:

- preparar combate;
- equipar arma;
- lutar ou fugir;
- buscar materiais;
- fabricar/equipar ferramenta;
- voltar à base;
- guardar inventário;
- replanejar rota;
- continuar o objetivo;
- esperar apenas quando há uma razão concreta.

O endpoint `/choose` apresenta opções ao modelo com chaves neutras
`A/B/C...`. Os IDs semânticos não são usados como rótulos do `choice`.

## Cenários

O V2 contém sequências como:

1. fome com comida disponível;
2. creeper a curta distância com vida crítica;
3. zumbi com arma equipada;
4. zumbi sem arma, mas com espaço para preparar;
5. preparar arma antes de explorar;
6. coletar materiais → fabricar arma → explorar;
7. fabricar picareta → minerar;
8. inventário cheio → voltar → guardar → retomar;
9. falhas repetidas → replanejar rota;
10. minerar → creeper interrompe → fugir → retomar mineração;
11. noite sem equipamento → usar a base para se preparar;
12. cancelamento explícito.

## Métricas

A avaliação é por resultado da sequência, não por igualdade com um rótulo:

- taxa de cenários concluídos;
- violações de segurança;
- loops;
- escolhas inválidas;
- fallbacks técnicos;
- passos por cenário;
- chamadas de modelo;
- p50/p95 de latência;
- trace completo de cada decisão.

## Gate para considerar shadow mode

O runner marca `shadow_readiness.ready=true` somente quando:

- sucesso geral >= 80%;
- 0 violações de segurança;
- 0 loops;
- 0 escolhas inválidas;
- 0 fallbacks técnicos;
- todos os cenários críticos passam:
  - fome;
  - creeper crítico;
  - zumbi armado;
  - zumbi sem arma;
  - cancelamento;
- p95 <= 2 segundos.

Esse gate serve apenas para permitir o próximo experimento. Não autoriza controle
autônomo do servidor.

## Rodar

Primeiro inicie o sidecar Laya:

```bash
USE_TF=0 python scripts/laya-decision-server.py
```

Espere o warm-up terminar e o serviço anunciar `/decision, /choose`.

Depois:

```bash
LAYA_PLAYER_LOOP_URL=http://127.0.0.1:8765/choose \
MBOT_PLAYER_LOOP_OUT=.data/player-loop-v2.json \
npm run gauntlet:player-loop
```

Sem `LAYA_PLAYER_LOOP_URL`, o mesmo comando executa somente o baseline
determinístico e é usado pela CI.

## Próximo passo

Somente se o V2 passar o gate, implementar shadow mode no runtime real:

```text
estado real → candidatos reais → Laya escolhe → registrar escolha
                                  ↓
                         NÃO executar escolha
                                  ↓
                 executar plano determinístico atual
                                  ↓
                     comparar resultado observado
```
