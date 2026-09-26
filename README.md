# Minecraft Bot Companheiro e Orquestrador

Bot companheiro e orquestrador para **Minecraft Java 1.20.1** com compatibilidade adicional para Forge 26.3, usando **mineflayer**.

## Status Atual

O `eduardo_bot` agora também funciona como **orquestrador da colônia**. Ele pode criar e remover bots auxiliares, consultar o registro de itens/blocos do Minecraft e montar planos simples de crafting a partir das receitas disponíveis no Mineflayer.


| Item | Status |
|------|--------|
| **Perfil recomendado** | Minecraft Java 1.20.1 ✅ |
| **Compatibilidade legada** | Forge 26.3 / protocolo 777 ✅ |
| **Conexão / chat / spawn** | Implementados ✅ |
| **Movimentação e pathfinder** | Implementados ✅ |
| **Colônia / projetos / persistência** | Implementados ✅ |
| **Smoke E2E 1.20.1** | Pronto via `!smoke`; validar no servidor real ⏳ |

## Pré-requisitos

- Java compatível com o servidor Minecraft ✅
- Node.js 22+ ✅
- Servidor Minecraft Java 1.20.1 recomendado ✅
- Forge 26.3 continua disponível como perfil de compatibilidade

## Como usar

### 1. Abra o mundo no modo LAN
1. Abra o TLauncher e entre no mundo **"Novo mundo"**
2. No jogo, pressione **Esc** > **"Abrir para LAN"**
3. Ative "Permitir cheats"

### 2. Configure o bot (opcional)
O bot detecta sozinho a porta do mundo LAN (procura portas abertas pelo Java
e faz um ping de status) e usa a versão anunciada pelo servidor.
Para forçar valores:

```bash
MINECRAFT_PORT=25565 MINECRAFT_VERSION=1.20.1 MINECRAFT_PROFILE=vanilla1201 node index.js
```

Se o servidor estiver em outra máquina, configure `MINECRAFT_HOST` e
`MINECRAFT_PORT` (a detecção automática só funciona para servidor local).

### 3. Rode o bot
```bash
npm install
node index.js
```

## Servidor 24h

Para deixar o bot jogando sempre, num servidor dedicado na rede local (com
reconexão automática e serviços do systemd), veja [deploy/README.md](deploy/README.md).

## Estrutura

```
minecraft-mbot/
├── index.js          # Conexão, estados, fuga e comandos
├── lib/
│   ├── food.js       # Comer e buscar comida
│   ├── craft.js      # Fabricar (com mesa) e usar a fornalha
│   ├── gather.js     # Coletar blocos (pula os inalcançáveis)
│   ├── combat.js     # Lutar ou fugir, arma e recarga do golpe
│   └── perception.js # Reconhecer blocos e entidades em volta
├── package.json      # Dependências
├── node_modules/     # Pacotes instalados
└── README.md         # Este arquivo
```

## Notas Técnicas

O Forge 26.3 usa o protocolo **777**, que é muito recente e ainda não tem suporte nativo em `minecraft-data`. O `minecraft-data` (versão 3.117.0) lista `26.1` como a última versão suportada.

Foram feitas as seguintes modificações para enable o bot:
- Adicionada entrada `26.3` ao `data.js` do `minecraft-data`
- Criada pasta `data/pc/26.3/` baseada em `26.1`
- Adicionado `26.3` ao `testedVersions` do `mineflayer`
- Adicionado `26.3` ao `prismarine-chunk`

Para funcionalidade completa (movimentação, blocos, inventário), aguarde `minecraft-data` adicionar suporte nativo ao protocolo 26.3.

## Troubleshooting

- **"name_taken"**: O username do bot já está em uso. Use um nome diferente.
- **"ECONNREFUSED"**: O servidor LAN não está ativo. Abra o mundo em LAN no jogo.
- **Porta diferente / detecção falhou**: use `MINECRAFT_PORT=<porta exibida pelo Minecraft> node index.js`.
- **Bot conecta mas não entra no mundo**: não use `version: false` nem desative os plugins `physics`/`blocks`; sem eles o servidor nunca completa o spawn.
- **"chunk size" warnings**: Esperado — protocolo incompleto, não é fatal para chat.
- **"unsupported protocol version"**: defina `MINECRAFT_VERSION=26.3`.

## Comandos no chat

| Comando | O que faz |
|---|---|
| `!seguir` | Segue o dono (padrão ao entrar) |
| `!ficar` | Fica parado onde está |
| `!minerar <bloco> [qtd]` | Minera blocos próximos, ex.: `!minerar oak_log 5` |
| `!fabricar <item> [qtd]` | Fabrica o item, coletando madeira/pedra e fazendo a mesa se precisar, ex.: `!fabricar wooden_pickaxe` |
| `!cozinhar [item] [qtd]` | Sem item: cozinha a comida crua. Com item: usa a fornalha, ex.: `!cozinhar raw_iron` |
| `!atacar [mob]` | Ataca o monstro mais próximo (ou o mob indicado, ex.: `!atacar zombie`) |
| `!comer` | Come a melhor comida do inventário |
| `!comida` | Sai para buscar comida |
| `!ver` | Descreve o que vê: bloco sob os pés, recursos e mobs por perto |
| `!cancelar` | Cancela a tarefa e volta a seguir |
| `!status` / `!pos` | Mostra vida, fome, itens e posição |
| `!ajuda` | Lista os comandos |
| `!parar` | Desconecta o orquestrador e encerra os bots auxiliares |
| `!bot criar [papel] [qtd]` | Cria bots auxiliares, ex.: `!bot criar minerador 3` |
| `!bot remover <nome>` | Remove um bot da colônia |
| `!base aqui` | Define a posição atual do jogador como base da colônia |
| `!base status` | Mostra as coordenadas da base |
| `!base limpar` | Remove a base e desativa o modo automático |
| `!colonia necessidades` | Mostra os déficits atuais calculados a partir do estoque |
| `!projeto <casa|fazenda|mina|vila>` | Inicia um projeto e cria as profissões que faltarem |
| `!projeto status` | Mostra progresso, recursos faltantes e obras |
| `!projeto cancelar` | Cancela o projeto atual |
| `!construir fazenda` | Prepara fisicamente um canteiro 5x5 próximo à base |
| `!construir mina [comprimento]` | Abre fisicamente um túnel de mineração |
| `!smoke` | Executa verificações ao vivo de spawn, registry, base, estoque e workers |
| `!bots` / `!colonia` | Mostra tamanho, papéis e estado da colônia |
| `!item <nome>` | Consulta item/bloco no registro do Minecraft |
| `!receita <item> [qtd]` | Verifica receita e materiais que faltam no inventário |
| `!local salvar <nome>` | Salva sua posição atual como local persistente |
| `!local listar` | Lista os locais salvos |
| `!local remover <nome>` | Remove um local salvo |
| `!ir <local>` | Manda o EduardoBot até um local e ficar lá |
| `!voltar [local]` | Volta para `base` por padrão ou outro local salvo |
| `!patrulha <a> <b> [...]` | Patrulha continuamente entre locais salvos |
| `!patrulha off` | Encerra a patrulha |
| `!enviar <bot> <local>` | Manda um worker específico até um local |
| `!explorar <local> [raio]` | Manda um explorador reconhecer a região de um local |
| `!animais [raio]` | Conta animais suportados próximos |
| `!reproduzir <animal> [pares]` | Alimenta pares para tentar reprodução |
| `!tosquiar [qtd]` | Tenta tosquiar ovelhas próximas |
| `!produto <la|leite|ovos> [qtd]` | Coleta produto animal não letal usando um fazendeiro |
| `!manejo <animal> [alvo]` | Tenta elevar a população até uma meta limitada |
| `!construir curral [animal]` | Constrói um curral físico 7x7 para a espécie |

O dono é o primeiro jogador online, ou o definido em `MINECRAFT_OWNER`
(nesse caso só ele pode dar comandos). Ao tomar dano, o bot foge do agressor;
com HP baixo, foge de mobs hostis próximos antes de apanhar.

### Combate
Ao tomar dano ou quando um monstro chega a 5 blocos, o bot decide entre lutar e
fugir: foge de creepers (e de qualquer ameaça quando está cercado por 3+ inimigos
ou com pouca vida); avança sobre esqueletos e strays, porque fugir de flechas
não adianta; nos demais casos luta com a melhor arma do inventário, respeitando
o tempo de recarga do golpe, e recua se a vida cair a 6 ou menos. Depois da
luta, recolhe os drops e volta ao que fazia (seguir ou ficar).

### Fome
Com fome (≤ 14), o bot come a melhor comida que tiver (evita carne podre, frango
cru etc., salvo em emergência). Sem comida, busca a fonte mais próxima num raio
de 48 blocos: caça vacas, porcos, ovelhas, galinhas e coelhos (poupando os 2
últimos de cada espécie para se reproduzirem), colhe cenoura, batata e beterraba
maduras (replantando) e frutas de arbustos. Se não achar nada, avisa uma vez no chat.


## Colônia de bots

Papéis disponíveis nesta primeira versão:

- `minerador`
- `lenhador`
- `fazendeiro`
- `construtor`
- `explorador`
- `guarda`
- `ajudante`
- `artesao`

Exemplos:

```text
!bot criar minerador 3
!bot criar fazendeiro 2
!bots
!item iron_pickaxe
!receita iron_pickaxe 2
!bot remover minerador_01
```

O limite padrão é de **12 bots contando o orquestrador**. Pode ser alterado com:

```bash
MAX_COLONY_BOTS=8 node index.js
```

Os bots auxiliares entram no mundo, recebem um papel e agora executam tarefas reais. O orquestrador divide ordens entre os bots da mesma profissão, acompanha o estado de cada um e pode operar a colônia em modo automático.

## Arquitetura do orquestrador

```text
Você
  ↓
eduardo_bot
  ├── CommandRouter
  ├── MinecraftKnowledge
  ├── Planner
  └── BotManager
        ├── minerador_01
        ├── lenhador_01
        ├── fazendeiro_01
        └── ...
```

- **CommandRouter**: interpreta os novos comandos da colônia.
- **MinecraftKnowledge**: consulta itens, blocos, alimentos e receitas do registro carregado pelo Minecraft.
- **Planner**: calcula o que já pode ser fabricado e quais ingredientes ainda faltam.
- **BotManager**: cria, acompanha e encerra os bots auxiliares.


## Ordens e autonomia

Comandos principais:

```text
!ordem mineradores ferro 64
!ordem lenhadores madeira 128
!ordem fazendeiros comida 10
!ordem exploradores explorar 96
!ordem guardas proteger 20

!todos voltar
!base aqui
!tarefas

!construir casa

!colonia auto
!colonia auto off
```

### Comportamento por profissão

- **minerador**: procura e minera o recurso solicitado, equipa automaticamente a melhor ferramenta disponível e recolhe drops;
- **lenhador**: localiza troncos e corta madeira;
- **fazendeiro**: procura comida, caça de forma conservadora e colhe/replanta culturas suportadas;
- **explorador**: percorre pontos progressivamente mais distantes da base;
- **guarda**: acompanha o dono e ataca hostis próximos;
- **construtor**: executa o blueprint inicial de um abrigo 3x3;
- **ajudante**: pode retornar à base e receber futuras tarefas genéricas.

A base é definida explicitamente pelo jogador com `!base aqui`. O comando usa a posição do jogador que enviou a ordem, não a posição do bot. A base pode ser consultada com `!base status` e removida com `!base limpar`.

O modo `!colonia auto` agora é orientado por demanda real. Ele exige **base + estoque central** configurados e distribui tarefas apenas a workers ociosos. Ordens manuais continuam disponíveis e substituem a tarefa atual do worker.

### Construção

`!construir casa` usa um construtor disponível e cria um abrigo 3x3 próximo à base. Se ele não tiver pelo menos 23 blocos adequados no inventário, tenta retirá-los automaticamente do estoque central.


## Estoque central e cadeia de produção

A colônia pode usar um **baú, baú-armadilha ou barrel real** como estoque compartilhado.

Fique próximo ao container e use:

```text
!estoque aqui
!estoque status
!estoque guardar
```

Depois disso:

- mineradores e lenhadores descarregam automaticamente recursos coletados;
- fazendeiros descarregam excedentes, preservando comida para sobrevivência;
- ferramentas, armas e comida mínima ficam com os workers;
- operações no mesmo container são serializadas para evitar dois bots manipularem o baú simultaneamente;
- construtores retiram blocos do estoque quando precisam;
- mineradores, lenhadores e guardas tentam retirar uma ferramenta adequada do estoque antes de produzir uma nova.

### Artesão

Crie pelo menos um artesão:

```text
!bot criar artesao
```

Ele pode receber ordens de produção:

```text
!fabricar picareta_ferro 2
!fabricar machado_ferro 2
!fabricar ferro 8
!fabricar vidro 16
```

O sistema resolve cadeias de crafting de forma recursiva. Exemplo:

```text
iron_pickaxe
  -> iron_ingot + stick
  -> raw_iron -> furnace -> iron_ingot
  -> log -> planks -> sticks
  -> crafting_table
  -> iron_pickaxe
  -> estoque central
```

Se uma receita exigir bancada e não houver uma por perto, o sistema tenta obter/fabricar e posicionar uma `crafting_table`. O mesmo ocorre com a `furnace` quando é necessário fundir raw iron, raw gold, raw copper, sand ou madeira para carvão vegetal.

### Abastecimento

É possível mandar um worker retirar um item específico do estoque:

```text
!abastecer minerador_01 iron_pickaxe 1
!abastecer construtor_01 cobblestone 32
```

Na rotina normal, mineradores e lenhadores já tentam se abastecer sozinhos com ferramentas.

### Fluxo atual

```text
COLETA
  ↓
ESTOQUE CENTRAL
  ↓
FUNDIÇÃO
  ↓
CRAFTING
  ↓
FERRAMENTAS / MATERIAIS
  ↓
WORKERS / CONSTRUTORES
  ↓
NOVOS RECURSOS
```

## Autonomia por demanda

Com base e estoque definidos:

```text
!base aqui
!estoque aqui
!colonia auto
```

O orquestrador mantém metas mínimas para comida, madeira, combustível, ferro, materiais de construção e reserva de ferramentas. Ele lê o estoque central e escolhe tarefas conforme o déficit:

```text
pouco carvão      -> minerador busca carvão
pouco ferro       -> minerador busca ferro
pouca madeira     -> lenhador busca madeira
pouca comida      -> fazendeiro produz comida
raw_iron sobrando -> artesão funde iron_ingot
faltam ferramentas -> artesão fabrica reposição
estoque estável   -> explorador pode explorar
guarda            -> protege o dono
```

Para consultar a demanda atual:

```text
!colonia necessidades
```

O estoque é sincronizado periodicamente. Se um worker falhar em uma tarefa automática, recebe um pequeno período de espera antes de nova tentativa para evitar loops de erro.


## Projetos da colônia

O orquestrador também trabalha com objetivos compostos. Um projeto aumenta temporariamente as metas do estoque, garante a composição mínima de trabalhadores e usa o modo automático para executar as etapas.

Comandos:

```text
!projeto casa
!projeto fazenda
!projeto mina
!projeto vila

!projeto status
!projeto cancelar
!projeto tipos
```

É obrigatório configurar antes:

```text
!base aqui
!estoque aqui
```

Ao iniciar um projeto, o EduardoBot verifica as profissões existentes. Se houver capacidade na colônia, cria automaticamente os bots que faltarem e ativa a orquestração automática.

### Projeto casa

Mantém reservas mínimas de materiais, comida, combustível, ferro e ferramentas. Depois dos recursos atingirem as metas, um construtor recebe a obra de um abrigo 3x3 próximo à base.

### Projeto fazenda

Prioriza uma reserva maior de alimentos e madeira e garante a presença de fazendeiro e artesão. Depois das metas de recursos, o fazendeiro executa uma ação física: prepara um canteiro 5x5, tenta criar irrigação central, ara a terra e planta sementes/comidas plantáveis disponíveis.

Para irrigação autônoma, deixe um `water_bucket` no estoque central ou construa a base perto de uma fonte de água. Sem água, a ação é considerada incompleta e será tentada novamente pelo projeto.

### Projeto mina

Cria uma equipe com dois mineradores, artesão, lenhador e guarda. Aumenta as metas de combustível, ferro, picaretas e materiais de construção e, depois, um minerador abre fisicamente um túnel de dois blocos de altura em uma formação rochosa próxima. Os blocos coletados são enviados de volta ao estoque central.

### Projeto vila

É o projeto mais amplo. A composição padrão é:

```text
2 mineradores
2 lenhadores
1 fazendeiro
1 artesao
1 construtor
1 guarda
1 explorador
```

O projeto aumenta as metas de comida, madeira, combustível, ferro, ferramentas e construção. Quando os recursos ficam prontos, a vila executa três casas em posições diferentes, uma fazenda física e uma entrada/túnel de mina.

Fluxo:

```text
!projeto vila
      ↓
verificar trabalhadores
      ↓
criar profissões ausentes
      ↓
aumentar metas do estoque
      ↓
coletar / fundir / fabricar
      ↓
atingir recursos necessários
      ↓
construir casas em offsets diferentes
      ↓
marcar projeto concluído
```

As casas podem usar uma combinação de cobblestone, stone, deepslate, planks e dirt disponíveis no estoque; não é mais necessário ter 23 blocos do mesmo tipo.


## Persistência da colônia

Base, estoque, modo automático, quantidade de workers por profissão e projeto atual são salvos localmente em:

```text
.data/colony-state.json
```

Esse arquivo está no `.gitignore` e não é enviado ao GitHub. O caminho pode ser alterado:

```bash
COLONY_STATE_FILE=/caminho/estado.json node index.js
```

Ao reiniciar o bot, ele tenta restaurar automaticamente:

```text
base
estoque central
workers por profissão
projeto em andamento
modo automático
```

Uma ação de projeto que estava em execução no momento da queda volta como **pendente**, para ser retomada com segurança em vez de ser considerada concluída sem confirmação.

## Smoke test no mundo real

O CI valida sintaxe e lógica sem um servidor Minecraft. Para validar a sessão real do Forge/TLauncher, depois de entrar no mundo use:

```text
!smoke
```

O teste verifica ao vivo:

- se o EduardoBot terminou o spawn;
- se o pathfinder está carregado;
- se o registry de itens/blocos está disponível;
- se a base foi definida;
- se o estoque central foi configurado;
- se o baú/barrel pode realmente ser aberto e lido;
- estado dos workers conectados;
- estado do projeto atual.

Exemplo de preparação:

```text
!base aqui
!estoque aqui
!bot criar minerador
!smoke
```

Esse comando é o smoke test E2E disponível para o ambiente real. Ele precisa ser executado no seu mundo porque o GitHub Actions não possui acesso ao servidor LAN da sua máquina.


## Roadmap

O roadmap técnico do projeto está em [`docs/ROADMAP.md`](docs/ROADMAP.md). Ele inclui a avaliação e a estratégia de adoção para `mineflayer-statemachine` e `mineflayer-builder`.

## Plugins avaliados para 1.20.1

A matriz de plugins Mineflayer e Paper/Spigot avaliados para esta versão está em
[`docs/plugins-1.20.1.md`](docs/plugins-1.20.1.md).

A recomendação atual é manter o comportamento crítico do bot com fallback próprio.
O primeiro plugin Mineflayer a ser testado como backend opcional será
`mineflayer-collectblock`. Para servidor Paper, CoreProtect e Chunky são os
candidatos operacionais mais úteis para uma colônia autônoma.


## Plugins de runtime opcionais

O bot pode carregar plugins da comunidade sem remover os fallbacks próprios.

```text
mineflayer-pvp
minecrafthawkeye
mineflayer-tool
mineflayer-collectblock
prismarine-viewer
mineflayer-web-inventory
```

Todos podem ser desligados:

```bash
MBOT_PLUGINS=0 node index.js
```

Ou pulados individualmente:

```bash
MBOT_PLUGINS_SKIP=pvp,hawkeye node index.js
```

A coleta própria continua sendo o padrão. O `mineflayer-collectblock` só assume quando explicitamente habilitado:

```bash
MBOT_COLLECTBLOCK=1 node index.js
```

Nos testes reais em 1.20.1, a coleta própria foi mais confiável em minério subterrâneo, então esse plugin permanece experimental.

Para acompanhar o bot pelo navegador:

```bash
MBOT_VIEWER_PORT=3007 MBOT_INVENTORY_PORT=3008 node index.js
```

- `3007`: visão 3D do bot;
- `3008`: inventário web.

Se um plugin não carregar ou não suportar a versão conectada, o bot registra a falha e continua com sua implementação própria.

## Perfil recomendado: servidor 1.20.1

Para o novo servidor, o perfil recomendado é Minecraft Java **1.20.1**. O bot detecta essa versão pelo ping e usa o protocolo normal, sem aplicar as correções específicas do Forge 26.3.

Pode forçar explicitamente:

```bash
MINECRAFT_HOST=127.0.0.1 \
MINECRAFT_PORT=25565 \
MINECRAFT_VERSION=1.20.1 \
MINECRAFT_PROFILE=vanilla1201 \
node index.js
```

Perfis disponíveis:

```text
auto          detecta pelo servidor
vanilla1201   força Minecraft 1.20.1 padrão/Paper
forge         usa camada Forge sem patches 26.3
forge263      mantém compatibilidade do ambiente Forge 26.3
```

Use no chat:

```text
!servidor
```

para ver versão, perfil e protocolo atualmente conectados. O `!smoke` também inclui o perfil do servidor nas verificações.

## Autonomia do companheiro

Além da automação da colônia, o próprio EduardoBot pode jogar sozinho como companheiro:

```text
!autonomo
!metas
!autonomo off
```

A progressão é determinística, sem LLM. Ele tenta manter comida, fabricar ferramentas, conseguir carvão/tochas, minerar e fundir ferro, produzir equipamento e vestir automaticamente a melhor armadura disponível.

As metas são calculadas usando o registro da versão conectada. Assim, itens que não existem no Minecraft 1.20.1, como tiers específicos de versões posteriores, não entram no planejamento.

### Segurança à noite

Quando está autônomo ou longe do dono durante a noite, o EduardoBot tenta:

1. encontrar uma cama próxima e dormir;
2. se não houver cama, localizar solo seguro;
3. cavar um pequeno abrigo;
4. fechar a entrada;
5. esperar amanhecer;
6. sair e continuar a tarefa anterior.

Enquanto está protegido no abrigo, ele não abandona o local para perseguir monstros.

### Equipamento

Periodicamente o EduardoBot:

- veste automaticamente a melhor armadura do inventário;
- verifica se já possui materiais para melhorar espada e picareta;
- fabrica a melhoria sem sair para coletar materiais extras;
- mantém combate/fuga como reflexos de maior prioridade.

O estado de `!autonomo` é persistido junto com base, estoque, workers e projetos.


## Locais, navegação e patrulha

Além da base, é possível salvar até 64 locais nomeados. Eles são persistidos no mesmo estado local da colônia.

Exemplo:

```text
!local salvar vila
!local salvar mina
!local salvar fazenda
!local listar
```

O nome é normalizado, então `Mina de Ferro` vira `mina-de-ferro`.

Para mover o EduardoBot:

```text
!ir mina
!voltar base
!voltar vila
```

Ao chegar com `!ir` ou `!voltar`, ele fica parado no destino. Uma ordem manual de navegação desliga o modo autônomo do companheiro.

### Patrulha

É possível criar uma rota contínua com dois ou mais locais:

```text
!patrulha base vila mina
!patrulha status
!patrulha off
```

A patrulha não é retomada automaticamente depois de reiniciar o processo. Os locais continuam salvos, mas a rota precisa ser iniciada novamente. Isso evita que o bot comece a se deslocar sem uma nova ordem depois de uma queda/restart.

Se combate, fuga ou outra ordem manual interromper a patrulha, ela é encerrada.

### Workers em locais específicos

Um bot auxiliar também pode ser enviado para um ponto salvo:

```text
!enviar minerador_01 mina
!enviar guarda_01 vila
```

Para exploração dirigida:

```text
!explorar mina 96
```

O orquestrador escolhe um worker com papel `explorador` e faz a exploração em torno daquele ponto, em vez de usar somente a base como centro.

### Dimensões

Cada local registra a dimensão em que foi salvo quando essa informação está disponível. O bot recusa navegação direta para um waypoint de outra dimensão; atravessar portais será tratado por uma camada específica de Nether/End em uma evolução posterior.


## Criação de animais

O EduardoBot e os fazendeiros agora conseguem trabalhar com criação animal de forma explícita.

Comandos:

```text
!animais
!animais 32

!reproduzir vaca 2
!reproduzir ovelha 2
!reproduzir porco 1
!reproduzir galinha 3

!tosquiar 5
```

Espécies suportadas:

```text
vaca / cow
ovelha / sheep
porco / pig
galinha / chicken
coelho / rabbit
cabra / goat
mooshroom
lhama / llama
```

O alimento usado depende da espécie:

```text
vaca, ovelha, cabra, mooshroom -> wheat
porco -> carrot / potato / beetroot
galinha -> sementes
coelho -> carrot / golden_carrot / dandelion
lhama -> hay_block
```

Se houver um worker `fazendeiro`, o orquestrador delega a tarefa a ele. Sem fazendeiro, o próprio EduardoBot executa.

O sistema reporta quantos animais foram **alimentados** e quantos pares foram tentados. Isso é intencional: o servidor ainda decide se a reprodução acontece de fato, pois animais jovens ou em cooldown podem aceitar/interagir de forma diferente.

Para tosquia, o bot procura `shears` no inventário, depois no estoque central e, se necessário, tenta fabricar uma tesoura usando a cadeia de produção. A lã coletada é enviada de volta ao estoque quando possível.

A reprodução continua sob comando explícito por padrão. Quando o curral físico da espécie está completo, reprodução e manejo passam a considerar somente os animais que estão dentro dele.


## Currais e manejo populacional

A criação animal agora possui uma camada física e uma camada de controle de população.

Para construir um curral:

```text
!construir curral vaca
!construir curral ovelha
!construir curral porco
```

O blueprint padrão tem **7x7 blocos**, com 23 cercas e 1 portão. O sistema tenta usar uma família de madeira disponível no inventário/estoque e, quando possível, fabricar as peças restantes pela cadeia de produção.

Cada espécie possui um offset padrão diferente em relação à base para evitar sobreposição entre currais.

O construtor é preferido para a obra. Se não houver construtor, um fazendeiro pode executar a construção.

### Meta populacional

Em vez de reprodução sem limite:

```text
!manejo vaca 8
!manejo ovelha 10
!manejo galinha 12
```

O sistema conta os animais próximos e calcula quantos pares devem ser tentados. Se a população já estiver na meta, não consome alimento. O número de tentativas também é limitado pela quantidade de animais disponíveis.

Exemplo:

```text
4 vacas + meta 8
-> déficit 4
-> no máximo 2 pares disponíveis naquele ciclo
```

O comando não abate animais acima da meta. Nesta etapa, o limite serve para impedir reprodução desnecessária; descarte/abate seletivo só será adicionado com regras explícitas de reserva mínima.


### Captura para o curral

Depois de construir o curral, consulte o estado:

```text
!curral vaca
!curral ovelha
```

O comando verifica o mundo real: quantidade de cercas, presença/estado do portão e quantos animais da espécie estão dentro.

Para levar animais encontrados nas proximidades para o curral:

```text
!capturar vaca 2
!capturar ovelha 4
!capturar galinha 6
```

É necessário ter um worker `fazendeiro`. O fazendeiro:

1. procura um alimento que atraia a espécie;
2. retira esse alimento do estoque central quando necessário;
3. encontra animais da espécie fora do curral;
4. aproxima-se segurando o alimento;
5. leva o animal até a entrada;
6. abre o portão;
7. entra no curral mantendo o alimento na mão;
8. confirma se o animal cruzou o limite;
9. fecha o portão;
10. sai sem alimento na mão e fecha novamente o portão.

O portão fica aberto apenas durante a passagem para reduzir fuga dos animais já confinados.

A associação entre espécie e curral é determinística a partir da posição da base. Por isso não é preciso salvar coordenadas adicionais: após um reinício, o sistema recalcula o mesmo local e valida se a estrutura ainda existe.

Quando um curral está completo:

```text
!reproduzir vaca 2
!manejo vaca 8
```

usam apenas vacas que estejam fisicamente dentro do curral. Se o curral estiver ausente ou incompleto, o comportamento anterior por proximidade continua disponível como fallback.

A captura depende do comportamento nativo de atração do Minecraft e do caminho estar livre entre o animal e o portão. Terreno irregular, água, cercas extras ou obstáculos podem impedir uma captura; nesses casos a tarefa reporta menos animais capturados do que o solicitado.


### Metas automáticas de rebanho

É possível transformar o tamanho do rebanho em uma meta persistente da colônia:

```text
!curral meta vaca 8
!curral meta ovelha 10
!curral metas
```

Para remover uma meta:

```text
!curral meta vaca off
```

As metas são salvas em `.data/colony-state.json` junto com o restante do estado da colônia.

Quando `!colonia auto` está ativo, o orquestrador usa esta ordem:

```text
projeto ativo
  ↓
metas de animais
  ↓
demanda comum do estoque
```

Para cada espécie configurada:

```text
curral ausente/incompleto
  -> fazendeiro tenta construir o curral

menos de 2 animais dentro
  -> tenta capturar animais próximos até formar o par inicial

2 ou mais, abaixo da meta
  -> entra no curral e tenta reprodução controlada

meta atingida
  -> nenhuma ação
```

O alvo é limitado a 2–32 animais por espécie. Falhas de terreno, falta de alimento, ausência de animais próximos ou curral obstruído entram no sistema de backoff do modo automático. Depois de uma tentativa de reprodução considerada bem-sucedida, a espécie recebe um cooldown de 5 minutos antes de outra tentativa automática, evitando consumo repetitivo de alimento.


## Produção animal não letal

Com um fazendeiro e currais funcionais:

```text
!produto la 8
!produto leite 3
!produto ovos
```

- **Lã:** usa o curral de ovelhas, obtém tesoura, ignora filhotes, recolhe os drops e deposita no estoque.
- **Leite:** usa o curral de vacas, obtém baldes antes de entrar, aproxima-se fisicamente das vacas adultas e confirma os baldes de leite.
- **Ovos:** entra no curral das galinhas e recolhe apenas ovos já existentes no chão; não espera indefinidamente.

Essas tarefas não abatem animais e não reduzem metas populacionais. Carne e couro permanecem fora desta etapa até existir política explícita de reserva mínima.
