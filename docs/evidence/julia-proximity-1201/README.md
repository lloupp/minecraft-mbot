# Julia-1 × distância da comida e da base (fome) — Minecraft Java 1.20.1

HEAD `7bc3ff7` da branch `experiment/julia-laya-andy-player-loop-v2`.
Julia-1 em shadow mode, **sem autoridade de execução**; Laya/Andy/NanoAndy
desligados; servidor vanilla 1.20.1 descartável. `npm ci`, `npm run check`,
`python -m py_compile scripts/julia-decision-server.py` OK; `npm test` **415/415**.

## Conclusão

**O contexto de distância NÃO corrigiu o viés: viés persistente.** Em 75
decisões válidas de fome, distribuídas em 4 combinações de distância, a Julia
escolheu `find_food` **0 vezes** (100 % `return_base`, confiança ≥ 0,9987) —
inclusive com comida a 2 blocos e base a 57. Uma varredura offline de 180
combinações (comida 0,5–8 blocos, base 3–500, food 1–8) também deu 0
`find_food`, com P(`find_food`) ≤ 0,0009 e sem tendência na direção esperada.
**Autoridade não concedida.**

## O que a Julia recebeu (confirmado no payload real)

Um proxy de gravação (`tee_proxy.py`) na frente do sidecar registrou o corpo
exato de cada requisição: **93/93** payloads de fome tinham `nearby.food=true`,
`nearby.foodDistance` numérico, `baseDistance` numérico e os candidatos
`find_food` e `return_base`, com as frases "Nearby food is approximately X blocks
away." e "The known base is approximately Y blocks away." nas descrições.
**Ressalva de contrato:** o runtime envia `state.baseDistance` (nível raiz);
`state.base.distance` só existe no `compactState` do Gauntlet e **não** é enviado
no shadow. Em food 9–10 o conjunto real é `find_food/continue_objective`
(sem `return_base`), então esses níveis não entram na comparação.

## Grupos controlados (`groups/`)

Mesma unidade (`explorador_01`), inventário vazio, saúde 20, objetivo `explore`,
food 1–8 intercalado entre as células (mesma queda de fome para todas). Vaca
`NoAI`+`Invulnerable`, uma só, apenas teleportada (2 ou 6 blocos). Zonas de
base perto (~10) e longe (~57) com coordenadas fixas. **Os grupos são definidos
pelas distâncias medidas no log** (comida perto ≤ 3,5; longe 5–8; base perto
4–16; longe ≥ 40). Linhas com food 0 (11, todas `return_base`) foram excluídas.

| Grupo | Decisões | `find_food` | `return_base` | Confiança média (mín) | p50 / p95 (ms) | Erros / timeouts / inválidas | Violações / abandonos |
|---|---|---|---|---|---|---|---|
| G1 comida perto (2,0) / base longe (57,4) | 23 | **0** | 23 | 0,9999 (0,9987) | 449 / 522 | 0 / 0 / 0 | 0 / 0 |
| G2 comida longe (5,3–8,0) / base perto (7,6–13,4) | 19 | **0** | 19 | 1,0000 (0,9999) | 432 / 587 | 0 / 0 / 0 | 0 / 0 |
| G3 comida perto (2,0–3,3) / base perto (10,0–15,3) | 14 | **0** | 14 | 1,0000 (1,0000) | 451 / 489 | 0 / 0 / 0 | 0 / 0 |
| G4 (controle extra) longe / longe | 19 | **0** | 19 | 0,9999 (0,9994) | 436 / 499 | 0 / 0 / 0 | 0 / 0 |

Só a concordância com as regras (`find_food` primeiro) não é o critério: o que
importa é que a escolha **não varia** com a distância real.

## Varredura offline (`sweep.json`, `sweep.py`)

Replay do payload real gravado, alterando só food, `foodDistance`,
`baseDistance` e as frases correspondentes (sidecar direto; não é runtime).
180 combinações: **0 `find_food`**; P(`find_food`) máx. 0,00094, média 8e-5.
Comida a 0,5 bloco com base a 500 → P = 1,4e-5 (a mais "óbvia" é a menor).
Controles: ordem dos candidatos invertida (P 0,0012), sem frases de distância
(P 0,00025), invertida e sem frases (P 0,0057), `atBase=true, baseDistance=0`
(P 0,0004): sempre `return_base`. O viés está no julgamento do modelo sobre
esses critérios, não na ordem nem na ausência da distância.

## Tentativas descartadas (registradas para não maquiar)

1. Vaca morta a cada visita ⇒ dropava carne, o worker comia e o food voltava a
   15–17. 2. Vaca `Invulnerable` mas ainda morta por `kill` ⇒ mesmo vazamento.
3. Despacho 4–5 s após o `tp`: a exploração anterior continuava andando e a
   distância da base derivava (6,8; 26; 22). A versão final despacha ~1 s após
   o `tp` e usa uma vaca marcada só teleportada. Essas tentativas não entram
   nos números acima.

## Smoke dos outros cenários (`smoke/`, 84 decisões, 10 rodadas)

| Conjunto de candidatos | Antes (sessão de 712) | Agora |
|---|---|---|
| `fight_threat/escape_danger` (ameaça c/ arma) | fight 253, escape 12 | fight 30, escape 3 |
| `equip_best_weapon/escape_danger` | equip 162, escape 22 | equip 24 |
| `prepare_combat/escape_danger` (ameaça s/ arma) | prepare 39 | prepare 10 |
| `prepare_combat/continue_objective` (exploração) | prepare 141 | prepare 10 |
| `gather_materials/continue_objective` | continue 77 | continue 7 |

Mesma escolha majoritária em todos os conjuntos (amostras pequenas; escape
3/33 ≈ 9 % contra 4,5 %, dentro do ruído). Erros 0, timeouts 0, inválidas 0,
violações 0, abandonos 0; 22 interrompidas / 20 retomadas, `taskLineageId` em
84/84. **Alerta de latência:** p50 1,26 s, **p95 2,33 s**, máx 3,14 s (2 workers
disparando juntos + zumbis; o proxy de gravação também acrescenta um salto). Não
há gate aqui, mas é acima dos 2 s.

## Limites

Uma unidade de teste e vaca artificial (`NoAI`, invulnerável); food 1–8; sem
tráfego orgânico. O resultado não depende do desenho: a varredura offline
reproduz o viés fora do jogo.

## Próximos passos possíveis (não feitos aqui)

Tratar fome como guardrail determinístico (não delegar a escolha à Julia),
reescrever os critérios, calibrar/afinar o modelo, ou tirar `return_base` do
conjunto quando houver comida muito perto. Nenhuma foi implementada.

## Arquivos

`groups/` (decisões, payloads reais, análise, journal), `smoke/`, `sweep.py`/
`sweep.json`, `group_analysis.py`, `groups.sh`, `smoke.sh`, `tee_proxy.py`.
