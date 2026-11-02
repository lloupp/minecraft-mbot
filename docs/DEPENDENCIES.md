# Dependências fora do npm oficial

Por que cada dependência não convencional existe e quando revisar.

| Pacote | Origem | Motivo | Revisar quando |
|---|---|---|---|
| `mineflayer` | `npm:@wp2508/mineflayer@4.42.2` (fork de `wupengabc/mineflayer`) | Suporte ao protocolo 26.3 (777+), usado pelo perfil `forge263`. O mineflayer oficial (4.39.0) ainda não suporta. | O upstream publicar suporte a 26.3. |
| `minecraft-data` | `npm:@wp2508/minecraft-data@3.111.6` | Dados de blocos/itens/protocolo do 26.3 que acompanham o fork acima. Forçado em todas as dependências via `overrides`. | Junto com o `mineflayer`. |
| `minecraft-protocol-forge` | GitHub `PrismarineJS/node-minecraft-protocol-forge`, commit `54fc6a2` | `autoVersionForge` para o handshake Forge; não há versão publicada com a correção usada. Fixado por commit para que `npm install` seja reproduzível. | Sair uma versão no npm que inclua esse commit. |

Os forks só são necessários para o perfil Forge 26.3; o perfil recomendado
(`vanilla1201`) funciona com a API que é comum ao upstream.

## Auditoria

`npm audit --omit=dev` não deve ter vulnerabilidades `high` ou `critical`.
Estado em 2026-10-31: 0 high, 15 moderadas (antes: 4 high, 19 moderadas, 1 low).
As moderadas restantes vêm de dependências transitivas sem correção
compatível (`uuid` via `minecraft-protocol`/`prismarine-auth` e `minecrafthawkeye`; o bot não usa os modos v3/v5/v6 com buffer); servidores web do bot só
escutam em `127.0.0.1`.
