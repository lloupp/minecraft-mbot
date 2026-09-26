# Plugins avaliados para Minecraft Java 1.20.1

Avaliação feita em 2026-09-26 para o `minecraft-mbot`.

## Regra de integração

O projeto usa um fork de Mineflayer e já possui lógica própria para coleta, combate,
fome, equipamento, estoque e orquestração. Portanto:

1. não substituir comportamento estável apenas porque existe um plugin;
2. testar primeiro em branch separada;
3. manter fallback próprio;
4. evitar dependência que duplique uma camada mais avançada já existente.

## Plugins Mineflayer

| Plugin | Situação | Uso potencial | Decisão atual |
|---|---|---|---|
| mineflayer-collectblock | candidato forte | coleta de blocos, ferramenta, drops e filas | testar depois como backend opcional; não substituir `lib/gather.js` ainda |
| mineflayer-tool | candidato | seleção automática da melhor ferramenta | útil como fallback/validação, mas já usamos `bestHarvestTool` |
| mineflayer-pvp | compatível com Mineflayer 4.x | PVP/PVE básico | não substituir `lib/combat.js`; nossa lógica possui fuga, creepers e prioridades próprias |
| mineflayer-auto-eat | ativo, mas ESM-only | alimentação automática | não integrar agora; o projeto é CommonJS e já possui `lib/food.js` |
| mineflayer-armor-manager | candidato | equipar melhor armadura | não integrar agora; `lib/equipment.js` já cobre essa função |
| mineflayer-statemachine | candidato arquitetural | máquinas de estado/behavior trees | avaliar quando a autonomia crescer mais |
| prismarine-viewer | candidato operacional | visualização do mundo do bot no navegador | interessante para servidor 24h/headless |

### Prioridade para teste

1. `mineflayer-collectblock`
2. `mineflayer-tool`
3. `mineflayer-statemachine`
4. `prismarine-viewer`

O primeiro teste deve ser feito sem remover o código atual, comparando:

- bloco alcançável e inalcançável;
- seleção de ferramenta;
- coleta de drops;
- cancelamento de tarefa;
- inventário cheio;
- depósito no estoque central;
- compatibilidade com o fork `@wp2508/mineflayer`.

## Plugins do servidor Paper/Spigot 1.20.1

### CoreProtect

Recomendado para o servidor de testes.

Motivo: registra alterações de blocos e permite rollback/restauração. É especialmente
útil quando construtores, mineradores e vários bots podem modificar o mundo.

Para 1.20.1, usar uma release que declare explicitamente suporte a 1.20/1.20.1
(em vez de simplesmente instalar a release mais nova).

### Chunky

Recomendado antes de exploração automática em grandes distâncias.

Pré-gera chunks e suporta a linha 1.20.x. Isso reduz geração de terreno durante a
exploração e tende a deixar o servidor mais previsível com vários exploradores.

### LuckPerms

Recomendado se o servidor tiver mais usuários ou se os bots precisarem de
permissões distintas.

Uso sugerido:

- grupo `owner`;
- grupo `bots`;
- negar comandos administrativos aos workers;
- liberar somente as permissões realmente necessárias.

### EssentialsX

Opcional. Útil para administração geral do servidor Paper/Spigot.

Não é necessário para o funcionamento do EduardoBot.

### WorldEdit + WorldGuard

Úteis para administração e proteção da base.

Observações:

- WorldGuard depende do WorldEdit Bukkit;
- WorldGuard é para servidores com Bukkit API, como Paper/Spigot;
- não deve ser tratado como plugin de Forge/vanilla;
- WorldEdit pode facilitar manutenção, mas não deve virar atalho para a progressão
  survival do bot se o objetivo é ele realmente coletar e construir.

### Citizens + Sentinel

Citizens possui builds da linha 1.20 e Sentinel teve release explicitamente
compatível com 1.20.1.

Não são prioridade para este projeto porque criam NPCs do lado do servidor,
enquanto a colônia atual usa clientes Mineflayer reais, coordenados pelo
EduardoBot.

## Conjunto recomendado para o servidor atual

Se o mundo for migrado/rodado em Paper 1.20.1:

```text
CoreProtect
Chunky
LuckPerms
EssentialsX (opcional)
WorldEdit + WorldGuard (opcional)
```

Não instalar Citizens/Sentinel apenas para substituir os workers Mineflayer.

## Próxima integração a testar

O candidato mais útil dentro do código é `mineflayer-collectblock`, mas deve
entrar atrás de feature flag e fallback:

```text
coleta solicitada
    ↓
plugin disponível e compatível?
    ├─ sim -> collectblock
    └─ não -> lib/gather.js atual
```

Somente depois de passar smoke test em Minecraft 1.20.1 real o backend por plugin
deve ser habilitado por padrão.
