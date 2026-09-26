# Problemas comuns

Primeiro lugar para olhar: `logs/latest.log` (procure `ERROR`, `Exception`, `Missing`).
Se o servidor caiu, o relatório está em `crash-reports/` e o `start-server` mostra o
caminho.

## Instalação e inicialização

| Sintoma | Causa / solução |
|---|---|
| `Java não encontrado` / `Java 8/11 encontrado` | instale o [Java 17](https://adoptium.net/temurin/releases/?version=17). Com vários Java: `JAVA=/caminho/jdk-17/bin/java ./start-server.sh` (Windows: `set JAVA=C:\...\bin\java.exe`) |
| Aviso `Java 21 detectado` | costuma funcionar, mas o testado é o 17; se aparecer erro de mixin/classe, use o 17 |
| `EULA não aceita` | `./install-server.sh --accept-eula` (Windows: `-AcceptEula`) |
| `Forge ... não instalado` | rode o `install-server` antes do `start-server` |
| `hash SHA-512 não confere` | o download veio corrompido ou o arquivo mudou na origem; rode de novo. Se persistir, não use o arquivo e confira a versão no Modrinth |
| PowerShell: "execução de scripts desabilitada" | use `powershell -ExecutionPolicy Bypass -File install-server.ps1` |
| `Missing or unsupported mandatory dependencies` | falta uma dependência ou há um jar de Fabric/NeoForge em `mods/`. Rode o `install-server` de novo: ele move jars fora do lock para `mods-removidos/` |
| `OutOfMemoryError` / servidor lento na coleta de lixo | aumente `MC_RAM` (6G). Com 8 GB no PC que também joga, não passe de 4G |
| Travadas ao explorar | geração de cidade é pesada; pré-gere a área ou reduza `view-distance` para 6 |
| `Can't keep up!` frequente | veja "Desempenho" abaixo |

## Conexão

| Sintoma | Causa / solução |
|---|---|
| `Mod rejections` / `mismatched mod list` | o cliente não tem os mesmos mods/versões. Rode o `install-client` de novo (usa o mesmo `mods.lock.json`) |
| `This server has mods that require Forge` | o perfil do cliente não é Forge 1.20.1 |
| Forge do cliente muito antigo | use Forge 1.20.1 **47.3.30 ou mais novo** (exigência do SecurityCraft) |
| `Took too long to log in` | cliente lento carregando dados do servidor (normal só na 1ª vez), ou um bot com handshake incompleto |
| `Connection refused` | servidor desligado, IP errado ou porta 25565 bloqueada (firewall/roteador) |
| Qualquer um entra com qualquer nome | é o `online-mode=false`; ligue a whitelist (README) |

## Jogo

| Sintoma | Causa / solução |
|---|---|
| Nenhum zumbi de dia | normal nos dias 1–3 (poucos); o spawner extra respeita o teto de cada fase. `/incontrol phases` mostra a fase, `/incontrol days` o dia |
| Zumbis demais | `/incontrol days` pode estar alto; ajuste os tetos em `config/incontrol/spawn.json` e `spawner.json` e rode `/incontrol reload` (precisa ser jogador op) |
| Nenhuma horda | hordas começam no dia ~4, à meia-noite do jogo, e só nascem no escuro. Teste: `execute as SeuNome run hordes start 4800` |
| Mundo sem cidades | o perfil só vale para mundo novo. Confira `world/serverconfig/lostcities-server.toml` (`selectedProfile = "apocalipse"`); para refazer, pare o servidor, **guarde o backup** e apague a pasta `world/` |
| Baús sempre vazios | 40% dos baús e 35% dos prédios vêm vazios de propósito; o Lootr dá loot próprio a cada jogador |
| Infectado (efeito de infecção) | coma uma **maçã dourada** antes do último estágio (~40 min) |
| Morreu e sumiram os itens | procure o **corpo** no local da morte (Corpse); qualquer jogador pode abri-lo |
| Comida virou carne podre | Spoiled: comida fresca dura ~3 dias de jogo; use o icebox do Cold Sweat, alga seca, mel |
| Bancada de armas/munição não aparece no JEI | desativadas de propósito; armas e munição só vêm do loot (CONFIGURATION.md) |

## Desempenho

1. `forge tps` no console mostra o TPS por dimensão (20 = perfeito).
2. Reduza, nesta ordem: `hordeSpawnMax` (Hordes), tetos do In Control, frequência das
   hordas (`hordeSpawnDays`), `simulation-distance`, `view-distance`.
3. Não remova Lost Cities/Zombie Awareness/Hordes para ganhar desempenho: ajuste os números.

## Restaurar um backup

```bash
# servidor parado
mv world world-quebrado
tar -xzf backups/world-AAAAMMDD-HHMMSS.tar.gz
./start-server.sh
```
No Windows: `tar -xzf backups\world-....tar.gz` no mesmo lugar.

## Bot (mineflayer) no servidor com mods

O bot deste repositório ainda não entra neste servidor: o `minecraft-protocol-forge` não
lê o registro do Forge 1.20.1 e responde errado ao canal de login do TaCZ, e o login
termina em `Took too long to log in`. Com um ajuste no handshake (responder
`Acknowledgement` aos registros e o `Acknowledge` do canal `tacz:handshake`) o bot entra
e joga; isso foi testado, mas não está integrado ao `index.js`.
