# Julia-1 com autoridade, medida contra um controle: base com cama, abrigo noturno, fatos para a Julia, vigia de progresso

Branch `experiment/autonomous-player-loop-next` (PR #88). As evidências anteriores, `../julia-authority-real-1201/` (r3)
e `../julia-authority-sustainability-1201/` (r4), ficam como estão. Esta etapa troca o método de avaliação: em vez de
um soak por versão, num mundo já gasto por horas de testes, cada versão roda 3 vezes contra um controle, sempre a
partir do mesmo mundo novo.

## 1. Método

- **Mundo novo, restaurado antes de cada execução.**
  - Gerado da mesma seed (`mbot-teste`), com o mesmo spawn (240,63,-110) e raio de spawn 2.
  - Dificuldade normal, ciclo dia/noite e monstros ligados, `keepInventory=false`.
  - O snapshot é copiado de volta antes de cada execução. Assim, nada se acumula de uma para outra: blocos cavados,
    tempo habitado no chunk, dificuldade local.
- **Braço de controle.** `MBOT_PLAYER_LOOP_CONTROL=1` (`070f3d1`) mantém o mesmo caminho e o mesmo registro, mas quem
  escolhe é a política determinística. A única diferença entre os braços é quem escolhe.
- **Pares em paralelo.** Cada par roda Julia e controle ao mesmo tempo, em dois servidores, e alterna as instâncias
  entre os pares.
- **Execução.** 60 min cada (3 dias e 3 noites do jogo), um explorador, nenhum item fornecido, nenhuma intervenção.
  O objetivo "explorar ao redor da base" é reemitido quando o explorador fica ocioso, como antes.
- **Código fixo.** Cada campanha roda num worktree congelado no commit medido (o `head` está no `infra.log` de cada
  execução).
- **Benchmark fixo de navegação** (`scripts/navbench.js`). 26 tentativas com origens e alvos fixos, usando a navegação
  real do `WorkerController` (exploração com `groundAware` e retorno à base com verificação). Sem monstros e de dia,
  para medir a navegação isolada.
- **Métricas** (`scripts/mstats.py`, `scripts/mcompare.py`). Mortes e causas, mortes de noite, noites completas sem
  morte, maior vida e vida mediana, comida obtida, decisões, fontes de decisão, pernas de exploração que falharam e
  maior parada (raio de 2 blocos).
- **Interrupção.** Um reinício do container interrompeu o par 2 da linha de base. Esse par ficou guardado como
  `*-interrompido`, fora da análise, e foi refeito do zero.

| campanha | código | o que contém |
|---|---|---|
| `base` | `070f3d1` | linha de base (HEAD anterior + braço de controle) |
| `new` | `5fcfcbe` | itens 2–4 + correção da percepção de comida + descrições ≤48 tokens |
| `final` | `7a96759` | `new` + rebanho lembrado sem animal caçável é invalidado |

## 2. Resultados (n=3 por grupo; `compare.json`, `stats.txt`)

| métrica (por execução de 60 min) | base controle | base Julia | new controle | new Julia | final controle | final Julia |
|---|---|---|---|---|---|---|
| mortes | 17, 4, 4 | 13, 9, 17 | 5, 14, 9 | **2, 8, 7** | 13, 12, 14 | **6, 8, 7** |
| mortes de noite | 16, 3, 4 | 9, 3, 15 | 3, 10, 6 | 1, 7, 7 | 8, 10, 11 | 3, 7, 4 |
| noites sem morte (de 3) | 0, 0, 2 | 0, 1, 0 | 2, 0, 1 | 2, 1, 1 | 1, 1, 0 | 1, 0, 1 |
| maior vida (min) | 15, 17, 42 | 14, 13, 16 | 34, 20, 30 | 34, 37, 21 | 14, 33, 17 | 16, 21, 17 |
| comida obtida (itens) | 7, 9, 7 | 5, 5, 5 | 9, 6, 16 | 13, 9, 11 | 9, 9, 11 | 10, 11, 16 |
| comeu (ciclos) | 1, 1, 0 | 2, 2, 2 | 2, 0, 0 | 5, 3, 3 | 0, 0, 2 | 4, 3, 4 |
| escolhas reais da Julia | – | 59, 36, 44 | – | 52, 52, 73 | – | 46, 67, 60 |
| fallbacks | 0 | 0, 1, 0 | 0 | 0 | 0 | 0 |
| pernas de exploração falhas | 7, 12, 2 | 5, 4, 3 | 7, 4, 6 | 3, 3, 6 | 8, 6, 11 | 7, 7, 5 |
| maior parada (min) | 3.9, 8.5, **38.5** | 0.6, 8.6, 3.8 | 6.5, 3.4, 5.3 | 9.0, 8.9, 7.3 | 8.7, **25.0**, 11.1 | 8.9, 5.5, 9.2 |

**Testes de permutação exatos**, juntando `new` e `final` como "depois" (n=6) contra `base` (n=3):

- Julia, mortes: 13,0 → 6,3 por hora (p=0,012). Maior vida: 14,5 → 24,3 min (p=0,024). Comida: 5,0 → 11,7 itens
  (p=0,012). Mortes de noite: 9,0 → 4,8 (p=0,14, não significativo).
- Controle: mortes 8,3 → 11,2 (p=0,81), maior vida 24,6 → 24,5, comida 7,7 → 10,0 (p=0,16). **Nenhuma melhora
  mensurável.**
- Pares no mesmo horário, código novo: a Julia morreu menos que o controle em **6 de 6** pares (p de sinal = 0,03).
  Na linha de base, morreu mais em 2 de 3.

**Navegação isolada (benchmark fixo):**

| campanha | pernas de exploração | retornos à base | tempo médio (exploração / retorno) |
|---|---|---|---|
| base | 16 de 18 | 7 de 8 | 12,2 s / 16,3 s |
| new | 16 de 18 | 7 de 8 | 12,0 s / 16,4 s |
| final | 16 de 18 | 7 de 8 | 12,0 s / 16,6 s |

Sem monstros e de dia, a navegação é boa e não mudou. As falhas do soak vêm do contexto (noite, combate, abrigo,
ciclos de decisão), não do pathfinder sozinho.

**Leitura.** As mudanças ajudaram o braço em que a Julia escolhe e não ajudaram a política determinística. A
determinística pega sempre o primeiro candidato, e a ordem herdada põe `return_base`/`prepare_combat` antes de
`sleep_or_shelter` à noite. A Julia passou a escolher abrigo e cama com as opções e os fatos novos:
`sleep_or_shelter` 11× e `make_bed` 18× na campanha `final`. Na linha de base, escolheu `sleep_or_shelter` 1× e `make_bed`
ainda não existia. Juntar `new` e `final`
simplifica, porque o código difere em uma correção.

## 3. O que mudou (cada item: reprodução → causa → correção → teste de regressão → teste real)

| item | mudança | teste real |
|---|---|---|
| 2 – cama | `make_bed` (só com campos explícitos do runtime): lã de ovelha ou linha, fabricar, voltar à base, colocar e usar a cama (`lib/bed.js`) | `targeted/t-bed1`: cama colocada em (237,63,-110); `SpawnX/Y/Z` do jogador = cama; dormiu à noite e acordou com a hora do mundo em 691. `t-bed3`: cama a partir de 12 linhas. `t-bed4`: caçou 3 ovelhas (3 lãs, de 2 cores; 5 carneiros) |
| 2 – noite armado | `sleep_or_shelter` oferecido ao lado de continuar quando o runtime informa abrigo executável; a cama da base a ≤64 conta, e o executor volta antes de dormir | `t-bed1`: escolheu abrigo, executou `night:dormi` |
| 3 – fatos para a Julia | estado com `edibleFood` (carne crua conta), `shelterKind`, `baseHasBed`, `bedMaterials` e ovelha à vista; descrições dizem o que a base oferece e como seria o abrigo; nenhuma escolha forçada | `t-bed6`: a Julia escolheu `make_bed` (confiança 0,79) |
| 3 – dados para retreino | a decisão com escolha real registra a entrada completa vista pela Julia; `scripts/julia-authority-dataset.js` exporta exemplos com o desfecho | `dataset-examples.jsonl.gz`: 1014 exemplos (`new` + `final`, os dois braços), com morte nos 5 min seguintes |
| 4 – vigia de progresso | parado (raio 2) por 3 min fora de abrigo/cama: registra contexto e intenção e libera o worker; ociosidade breve entre tarefas não zera a contagem | registrou as paradas do soak (ver §4) |
| 4 – benchmark | `scripts/navbench.js` | tabela acima |

**Bugs achados pela própria medição, cada um com teste de regressão que falha sem a correção:**

1. **Percepção de comida diferente do executor** (`2b03359`). O controle da linha de base fez 125 `find_food` seguidos
   com "comida a 5–15 blocos", e a maior parada (38,5 min) foi um ciclo desses. A percepção contava qualquer animal e
   qualquer planta. O executor poupa os 2 últimos animais de cada espécie e só colhe planta madura.
2. **Rebanho lembrado nunca invalidado** (`7a96759`). Chegando lá, havia só animais poupados ("caça=nada
   animais=true", repetido 57/42/33/28/16 vezes no controle de `new`).
3. **Descrições acima do contrato de 48 tokens da Julia-1** (`5fcfcbe`). O sidecar respondia 400 e a decisão caía no
   fallback. Medido com o tokenizador do modelo: máximo de 44 tokens agora (`julia-option-tokens.txt`).
4. **Lã de linha** (`2c7f480`). `bot.craft` com várias repetições na grade 2×2 consumiu 11 linhas e deu 1 lã. Agora a
   lã é feita uma unidade por vez.
5. **Orientação da cama** (`2db214b`). O `placeBlock` olha para o ponto clicado, então a cabeceira segue a direção do
   bot até o pé.

Testes: 616 → **632/632**. O gauntlet do player loop ficou idêntico, porque os cenários sem os campos novos do runtime
não mudam.

## 4. Onde ainda quebra (não escondido)

1. **A cama quase nunca sai no soak.** Foram 61 ciclos `bed:wool` nas campanhas novas, nenhuma cama colocada: faltam
   3 lãs da mesma cor. Há poucas ovelhas perto do spawn, as cores variam, e a lã se perde a cada morte. O caminho
   pela linha depende de aranhas (4 linhas por lã). O executor está comprovado só nos testes dirigidos.
2. **O abrigo cavado falha.** Nas campanhas novas, 19 de 29 tentativas. Motivos registrados: 8× não chegou ao lugar do
   abrigo, 6× não conseguiu sair do buraco, 3× o caminho expirou, 1× o pathfinder demorou demais para decidir.
3. **As noites continuam letais.** Mortes de noite: Julia 4,8 e controle 8,0 por execução. Noites completas sem morte:
   no máximo 2 de 3, a maioria das execuções com 0–1. Esqueletos, zumbis e afogados dominam.
4. **Ciclos de decisão que o vigia registra, mas não resolve.** No controle `final-2`, 25 min em (168,66,-79): 26×
   `fight_threat` → "tempo" (a luta expira sem alcançar o monstro), e o loop escolhe lutar de novo. Não foi corrigido
   nesta etapa, para que o código medido seja o código reportado.
5. **A Julia ainda prefere `return_base` a procurar comida** (61 de 61 em `final`). Os exemplos exportados mostram o
   custo: dos 115 `return_base` escolhidos pela Julia diante de `find_food`, 61 terminaram em morte nos 5 min
   seguintes. Não foi "corrigido" por regra. O caminho é retreinar com esses exemplos (não feito aqui).
6. **n=3 por grupo, com variância alta.** Os resultados do controle oscilam muito (mortes 4 a 17), então só as
   diferenças do braço Julia são estatisticamente claras.

## 5. Classificação: AUTONOMIA PARCIAL

**Comprovado com controle e mundo restaurado**, para a Julia com o código novo:

- metade das mortes;
- o dobro da maior vida;
- o dobro de comida;
- 0 fallbacks;
- melhor que a política determinística em 6 de 6 pares.

**Não comprovado:** sobrevivência sustentável. Ainda morre cerca de 6–7 vezes por hora e raramente atravessa uma noite
sem morrer. A cama, peça central contra a espiral noturna, funciona isolada, mas não aparece no soak.
