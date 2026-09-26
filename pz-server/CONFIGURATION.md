# Configuração

Só versionamos as configs que mudamos; as demais são geradas pelos mods com o padrão.
Depois de editar, reinicie o servidor (loot e spawners de prédio: `/reload` basta).

## Servidor (`server.properties`)

| Chave | Valor | Por quê |
|---|---|---|
| `difficulty` | `hard` | zumbis quebram portas de madeira e infectam mais; fortificar com SecurityCraft faz sentido |
| `view-distance` / `simulation-distance` | 8 / 6 | moderado para hardware modesto; mobs só "vivem" até 6 chunks do jogador |
| `max-players` | 8 | |
| `online-mode` / `enforce-secure-profile` | `false` / `false` | contas TLauncher e o bot; **use a whitelist** |
| `white-list` / `enforce-whitelist` | `false` | ligue com `/whitelist on` quando tiver a lista |
| `spawn-npcs` | `false` | sem aldeões vivos: apocalipse |
| `allow-flight` | `true` | evita kicks falsos de "flying" com mods de combate/movimento |
| `max-tick-time` | 120000 | a geração do Lost Cities pode ser lenta; evita o watchdog derrubar o servidor |
| `entity-broadcast-range-percentage` | 75 | menos entidades enviadas ao cliente |
| `spawn-protection` | 0 | todos podem construir perto do spawn |
| `sync-chunk-writes` | `true` (padrão) | mais seguro contra corrupção se o servidor cair |

RAM: `MC_RAM` no `start-server` (padrão 4G). GC G1 com os parâmetros usuais para
servidores Minecraft (pausas curtas, heap mínimo 1 GB para caber em PCs de 8 GB).

## Mundo: The Lost Cities

- `defaultconfigs/lostcities-server.toml`: `selectedProfile = "apocalipse"`. O Forge copia
  esse arquivo para `world/serverconfig/` quando o mundo é criado; **só vale para mundo
  novo**.
- `config/lostcities/profiles/apocalipse.json`: cópia do perfil `default` com
  - `buildingMaxFloors` 8 → **6** (geração mais leve, menos prédios gigantes);
  - `ruinChance` 0.05 → **0.15**, `explosionChance` 0.002 → **0.004**,
    `miniExplosionChance` 0.03 → **0.05** (mais destruição);
  - `chestWithoutLootChance` 0.2 → **0.4**, `buildingWithoutLootChance` 0.2 → **0.35**
    (loot escasso);
  - `generateLighting = false` (prédios escuros: zumbis nascem dentro).

## Zumbis e progressão por dia

**In Control** (`config/incontrol/`):
- `spawn.json`: nega no Overworld creeper, esqueleto, stray, aranha, aranha de caverna,
  enderman, bruxa, phantom, slime, saqueadores (pillager/vindicator/evoker/ravager/vex) e
  cavalo esqueleto. Limita zumbis naturais por fase (conta todos os hostis do mundo).
- `phases.json`: fases pelo contador de dias do In Control (`/incontrol days`).
- `spawner.json`: spawns extras de zumbis **também de dia** (a 24–56 blocos do jogador),
  em grupos que crescem por fase.

| Fase | Dias | Teto de zumbis naturais | Spawner extra (grupo / teto) | Hordas |
|---|---|---|---|---|
| `dias_1_3` | 1–3 | 20 | 1 zumbi / 10 | não |
| `dias_4_7` | 4–7 | 35 | 1–2 (zumbi, aldeão zumbi) / 18 | 1ª horda no dia ~4 |
| `dias_8_15` | 8–15 | 50 | 2–3 (+ husk) / 26 | a cada 4 dias |
| `dias_16_30` | 16–30 | 65 | 2–4 / 34 | hordas maiores (+10% cada) |
| `dia_30_mais` | 30+ | 80 | 3–5 / 42 | até ~29 por onda no dia 48 |

> **Atenção (bug do In Control 9.5):** no `spawner.json` a condição de dias é
> "dia ≥ `mindaycount` **OU** dia < `maxdaycount`". Por isso as regras são cumulativas
> ("a partir do dia N", sempre com `"maxdaycount": 0`). Não use faixas fechadas lá.
> No `spawn.json` as fases funcionam normalmente.

**Zombie Awareness** (`config/zombieawareness/MobLists.toml`): só zumbi, husk, aldeão
zumbi e afogado são "aprimorados" (antes incluía creeper/esqueleto/bruxa). Som (quebrar
e bater em blocos), cheiro/sangue e luz atraem zumbis num raio de até 64 blocos;
zumbis que rosnam chamam outros. O addon **TACZ-Sound Attracts Zombies** faz tiros
virarem som (silenciador reduz o alcance).

**The Hordes** (`config/hordes-common.toml` e `config/hordes/`):

| Chave | Padrão | Aqui | Motivo |
|---|---|---|---|
| `hordeSpawnDays` | 10 | **4** | ataques periódicos |
| `hordeSpawnVariation` | 0 | **1** | a horda pode atrasar 1 dia |
| `spawnAmount` | 25 | **10** | começa pequena |
| `hordeSpawnMultiplier` | 1.05 | **1.1** | cresce 10% a cada horda |
| `hordeSpawnDuration` / `Interval` | 6000 / 1000 | **4800 / 1200** | 4 ondas de 1 min |
| `hordeSpawnMax` | 160 | **50** | teto de zumbis vivos da horda (desempenho) |
| `hordePathingInterval` | 10 | **20** | recalcula caminho 1×/s (desempenho) |
| `hordeSpawnDistance` | 75 | **48** | nasce a uma distância que chega na base |
| `zombiesBurn` | false | false | zumbis andam de dia |
| `playerInfectionResistance` | 0.25 | **0.85** | 15% de chance de infectar por mordida |
| `ticksForEffectStage` | 6000 | **12000** | ~40 min para achar a cura (maçã dourada) |
| `zombiePlayersStoreItems` | true | **false** | o Corpse guarda os itens do jogador morto |
| `illagersHuntZombies` | true | false | sem saqueadores no mundo |

- `config/hordes/data/hordes/horde_data/tables/default.json`: zumbis desde o dia 0,
  husk e bebê zumbi a partir do dia 8, zumbi com espada no 12, com couro no 16, husk com
  malha no 24, zumbi com armadura de ferro no 32 (formato `entidade{nbt}-peso-diaMin-diaMax`).
- `config/hordes/hordes-info.json`: `data_version = -1` impede o mod de sobrescrever a
  pasta ao atualizar.
- Comandos: `/hordes start <duração>` (execute como o jogador:
  `execute as Fulano run hordes start 4800`), `/hordes stop`.

## Sobrevivência

| Mod | Arquivo | Mudança |
|---|---|---|
| Cold Sweat | `config/coldsweat/main.toml` | período de graça 6000 → **24000** ticks (1º dia sem dano de temperatura) |
| Spoiled | `config/spoiled-common.toml` | `defaultSpoilTime` 40 → **120** (comida fresca dura ~60 min reais ≈ 3 dias); maçã dourada, cenoura dourada, mel e alga seca não estragam; `cold_sweat:icebox` estraga 4× mais devagar |
| Serene Seasons | `config/sereneseasons/seasons.toml` | começa no **início do outono** (`starting_sub_season = 7`): inverno por volta do dia 24, quando as hordas já são grandes; plantações não crescem no inverno |
| First Aid | padrão | 8 partes do corpo; cabeça e tronco podem matar |
| Corpse | padrão | corpo guarda todo o inventário; qualquer jogador pode saquear |

## Loot (`moonlight-global-datapacks/pz-survival`)

Gerado por `python3 tools/build_datapack.py` (edite o script e rode de novo). O Moonlight
carrega essa pasta em todos os mundos.

- `data/lostcities/lostcities/conditions/chestloot.json` escolhe a tabela pelo prédio:

| Prédio do Lost Cities | Tabela |
|---|---|
| `building1..8`, `cabin` (casas e apartamentos) | doméstico (às vezes farmácia/oficina) |
| `shopping*` (mercados) | mercado + farmácia |
| `highway_restaurant*` | restaurante |
| `highway_gas_station` e porões | oficina |
| `library*`, `center*`, `town*` (biblioteca, centro, prefeitura) | escritório + clínica, raro militar |
| `radiotower`, dungeons do metrô | **militar** (armas e munição) |
| `oilrig*` | oficina, às vezes militar |

O Lost Cities não tem hospital nem delegacia; farmácias ficam em mercados e prédios
públicos, e o "militar/polícia" fica na torre de rádio e nas dungeons do metrô.

Resultado médio por baú (simulação de 20 000 baús por tabela; além disso o perfil deixa
40% dos baús e 35% dos prédios sem loot):

| Tabela | Baús vazios | Comida | Remédios | Chance de arma | Munição | Chance de mochila |
|---|---|---|---|---|---|---|
| domestic | 4% | 1.6 | 0.15 | 0.4% | 0.0 | 2.6% |
| market | 0% | 4.0 | 0.00 | 0.0% | 0.0 | 0.0% |
| military | 4% | 0.0 | 0.70 | 39.1% | 4.8 | 1.9% |
| office | 16% | 0.0 | 0.84 | 8.5% | 0.4 | 0.0% |
| pharmacy | 25% | 0.0 | 1.12 | 0.0% | 0.0 | 0.0% |
| restaurant | 0% | 3.8 | 0.00 | 0.0% | 0.0 | 0.0% |
| workshop | 6% | 0.0 | 0.00 | 0.0% | 0.0 | 2.4% |

- Armas: pistolas (Glock 17, M1911, CZ75, P320, M9A4), escopetas (cano duplo, M870),
  submetralhadoras (UMP45, MP5, Uzi) e fuzis (AK-47, M4A1, SKS, Kar98, M700). Sem
  metralhadoras, lança-foguetes ou snipers .50. Vêm **descarregadas**.
- Ferramentas de ferro, armaduras e ferramentas vêm gastas (20–70% de dano).
- Spawners de monstro dos prédios geram só zumbi, aldeão zumbi e husk.

## Armas (TaCZ)

- A **bancada de armas** e a **bancada de munição** não têm receita: armas e munição só
  vêm do loot (como no Project Zomboid). A bancada de acessórios continua craftável.
- Motivo técnico: o gun pack do TaCZ carrega depois dos datapacks, então não dá para só
  encarecer as receitas de munição; desativar a bancada funciona. Para liberar de novo,
  apague `data/tacz/recipes/ammo_workbench.json` do datapack (ou tire da lista em
  `build_datapack.py`).
- Tiro sem silenciador é ouvido a 64 blocos (`config/tacz-common.toml`, padrão).

## Validação (servidor de teste, 4 núcleos, heap 4 GB)

| Item | Resultado |
|---|---|
| Inicialização | `Done` em 55–67 s (1ª vez, criando o mundo); 3 s nos starts seguintes; nenhum `ERROR` do servidor |
| Lost Cities | perfil `apocalipse` ativo (`/lostcities debug`: 6 andares máx.), cidades a ~40 blocos do spawn |
| In Control | 0 creepers/esqueletos/aranhas/endermen; ~18 zumbis nos dias 1–3, ~48 no dia 8 |
| Zombie Awareness | zumbi a 42 blocos: sem barulho ficou a ≥ 25; com o jogador cavando chegou a 0,7 bloco em 40 s |
| Hordes | ondas de ~10 zumbis por minuto indo até o jogador (10 → 20 → 28 → 38) |
| TaCZ | Glock 17 + munição 9mm válidas; bancadas de arma/munição sem receita; acessórios ok |
| First Aid | queda de 4 de dano: pé esquerdo 0/4, pé direito 3,5/4 |
| Cold Sweat | temperatura ativa (modificadores de bioma, sombra, altitude, blocos) |
| Spoiled | comida recebe `SpoilMaxTime 120` e o timer anda |
| Corpse | jogador morto por aldeão zumbi: corpo criado no local com o inventário |
| Mochila | mochila com 27 slots e inventário próprio |
| Loot | todas as tabelas geram itens; IDs conferidos contra os jars |

Carga (1 jogador online):

| Cenário | Zumbis vivos | Heap usado | RSS do processo | CPU (de 400%) | TPS | Tick médio |
|---|---|---|---|---|---|---|
| Ocioso, sem jogador | – | 0,55 GB | 2,07 GB | – | 20 | 0,5 ms |
| 1 jogador, sem zumbis | 0 | 0,62 GB | 2,34 GB | 12% | 20 | 4,8 ms |
| 1 jogador + 50 zumbis | 50 | 1,21 GB | 2,34 GB | 19% | 20 | 8,4 ms |
| 1 jogador + 100 zumbis | 100 | 0,66 GB | 2,34 GB | 23% | 20 | 9,8 ms |
| Horda (3 min, ~38 zumbis) | 38 | – | – | – | 20 | 7,7 ms |

Nenhum travamento. O maior custo é gerar terreno novo (Lost Cities) quando alguém explora
rápido; se o TPS cair, reduza nesta ordem: `hordeSpawnMax` e os tetos do In Control,
`findSense_PercentChance` do Zombie Awareness (e aumente `tickCooldownBetweenPathfinds`), `simulation-distance`,
`hordeSpawnDays` maior e, por último, `view-distance`.
