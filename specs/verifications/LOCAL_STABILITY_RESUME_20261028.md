# Retomada no Linux — 28/10/2026

Branch de trabalho: `feat/local-stability-pr-review`; commit de partida `1bbcb2f`.
Esta rodada não certifica autonomia completa. Sem reinício do servidor Minecraft,
merge, push ou alteração de `.env`/launchers. Modelos sem autoridade.

## Ambiente e testes

- Node 24.22.1 instalado via nvm. O runtime padrão do terminal era Node 22.
- Primeira instalação falhou: subprocesso de dependência executou Node 19.8.1.
- `npm ci` concluído usando shell temporário fora do projeto que antepõe Node 24
  ao PATH também dos scripts npm. Manifestos de dependências não alterados.
- Antes da correção: sintaxe de 90 arquivos e 764/764 testes aprovados.
- Sete regressões do runTask real, isolado via VM sem conectar Minecraft:
  quatro falharam antes da correção e sete passaram depois.
- Depois da correção: sintaxe de 90 arquivos; 771/771 testes aprovados.
- LSP: nenhum diagnóstico retornado, mas confirmação inconclusiva para os dois
  arquivos; não interpretar silêncio do servidor como certificação de tipos.
- Diff de whitespace aprovado com `core.whitespace=cr-at-eol`; a migração já
  apresentava mudanças de finais de linha em centenas de arquivos. Não normalizar
  nem incluir essas mudanças em staging indiscriminado.

## Observado no jogo

Launcher `INICIAR_TESTE_CONTROLADO.sh`, estado `live-mission-state`.
Main conectado, HP 19/20, fome 6/20. Dashboard e viewer responderam HTTP 200.
Principal colocado em `!ficar`. Leitura física com `!estoque` confirmou:

```
acacia_sapling 15; gravel 5; acacia_fence 2; cornflower 1;
acacia_log 1; cobblestone 80; granite 8; coal 14;
oak_planks 2; stick 2; crafting_table 1.
```

Criado somente `fazendeiro_01`, conectado com HP/fome 20/20.
Ordem `78681d35-8957-41bf-b4be-d15b79e970dc`, `!ordem fazendeiro comida 1`:
status `falhou`, gathered=0, requested=1, exhausted=true, deposited={}.
Não houve alimento obtido nem recuperação de fome comprovada.
A resposta HTTP de aceite não foi contabilizada como sucesso físico.

Uma busca explícita `!comida` do main também não recuperou fome. Ao terminar,
runTask depositou a carga PREEXISTENTE (não nova coleta): oak_log 1, coal 5,
oak_sapling 1, stick 1, dirt 1, coarse_dirt 1, granite 1, oak_planks 1,
cobblestone 12. A transferência consta no log e houve redução do inventário,
mas NÃO houve releitura física independente depois: depósito não certificado
por comparação antes/depois. Não inferir conteúdo atual do baú pelo cache.

## Incidente e contenção

runTask retomava `seguir` incondicionalmente mesmo tendo começado em `ficar`.
Após a busca alimentar, isso permitiu ao loop noturno iniciar abrigo automático.
O log registrou escavação de cobblestone em (-92,63,-45) e stone em
(-92,62,-45) e (-92,61,-45). Não afirmar ausência de alterações no terreno.
A tarefa foi interrompida com `!ficar`, sem tentativa de reparo automático.
Última posição observada: (-91.5,61,-44.46), HP 19/20, fome 6/20,
modo `ficar`, task=null; fazendeiro ocioso. Não houve morte observada.

## Correção local

`index.js`: runTask preserva `ficar` por padrão e herda o modo de retomada ao
substituir outra tarefa. Chamadores ainda podem pedir `resume` explicitamente.
Cancelamento não permite que a tarefa antiga sobrescreva comandos novos.
`test/main-task-resume.test.js`: sucesso, erro, depósito, seguir prévio,
override explícito, cancelamento e substituição de tarefa.

**A correção está no disco, não carregada no processo que continua rodando.**
Não foi reiniciado o bot para evitar que o spawn padrão em `seguir` disparasse
nova escavação. Não existe nesta rodada prova física pós-correção.
A correção não desliga a sobrevivência e não fornece arbitragem global.

## Próximos passos / bloqueios

1. Disponibilizar alimento ao principal (ou localizar fonte segura acessível).
   Não repetir ordens iguais sem nova fonte/evidência.
2. Inspecionar e recuperar posição/terreno alterado com autorização e medidas
   físicas; não iniciar mineração/construção enquanto esse risco persistir.
3. Preparar reinício controlado do bot com contenção desde o spawn, carregar a
   correção e validar `!ficar` após tarefa sem permitir abrigo não solicitado.
   Não reiniciar o servidor Minecraft.
4. Reler baú fisicamente após o depósito; não iniciar outra transferência antes.
5. Só então avançar para pequenos lotes de madeira/pedra/carvão/ferro,
   crafting e demais workers. Entrega dos 21 raw_iron históricos segue sem prova.
6. PR para main permanece pendente; nenhum commit/push/merge nesta rodada.
   Revisar staging explícito para excluir estado, logs, credenciais e ruído CRLF.

Evidências locais privadas: `logs/live-resume-20261028/` (snapshots e testes).
Não publicar esse diretório nem `.env`, estados ou logs em GitHub.

## Atualização posterior — autonomia autorizada e correções carregadas

O usuário autorizou autonomia do bot, ajustes incrementais e, se necessário,
ações do próprio bot sobre o terreno. Continua proibida alteração/reinício do
servidor Minecraft. Nenhuma intervenção externa no mundo foi feita.

Os estados descritos acima são históricos, não o estado atual. Entre as etapas,
o processo antigo registrou morte do fazendeiro por zumbi e morte do principal
por zumbi às 15:21Z. Main renasceu sem equipamento, com HP/fome 20/20; isto NÃO
é recuperação alimentar. O comando recebido `!ferro 4` foi cancelado antes do
reinício, sem sucesso alegado.

### Inicialização e autonomia

- Adicionado `MBOT_START_MODE=ficar` em `index.js`. É override de sessão;
  sem ele, o lançamento original continua iniciando em `seguir`.
- `.env` e launchers não alterados. Reinícios somente do bot, por `!parar`
  (exit 0), seguidos do mesmo launcher com Node 24 e override acima.
- Spawn real em `ficar`/task=null confirmado. Defesa continua podendo agir;
  a opção NÃO é modo congelado/somente-leitura.
- `!autonomo` ativa o controlador determinístico existente do principal.
  Nenhum projeto, dispatcher concorrente ou autoridade de modelos ativados.

### Falhas físicas e correções adicionais

Primeira rodada autônoma escolheu picareta de madeira, coletou troncos para
crafting, mas entrou em luta desarmada com esqueleto e morreu às 15:28Z.
Depois do respawn ficou em `mode=tarefa`, `task=null`, sem retomar metas.

Correções carregadas em seguida:

- A morte cancela a tarefa antiga e restaura o modo: autonomia retorna a
  `seguir`; tarefa manual iniciada em `ficar` continua respeitando `ficar`.
- Laço não despacha trabalho com HP <= 0.
- Contra atiradores, reação automática só escolhe lutar se há arma de corpo a
  corpo ou arco utilizável; regras de vida mínima/creepers/cercamento mantidas.
- Enquanto ainda há ameaça incompatível com combate, fim do relógio de fuga
  não libera produção.

Na rodada seguinte, o recuo redefinia seu objetivo a cada 500ms e o principal
continuou descendo para cavernas, chegando a HP 2.5/20. Processo desconectado
normalmente para ajuste. Corrigido: manter caminho durante os 4s de fuga e só
então reavaliar ameaça; movimentos de seguir/fugir não cavam, não fazem parkour,
não erguem torres e limitam queda por passo a um bloco. Isso NÃO prova que o
bot nunca descerá por escadas/cavernas nem garante sobrevivência.

### Verificação final e evidência atual

- Sintaxe: 90 arquivos aprovados. Suíte JavaScript: **784/784**.
- Regressões direcionadas: 37/37 (modo inicial/retomada, morte, combate,
  recuo e reservas automáticas). Falhas novas reproduzidas antes do ajuste.
- Aviso histórico de TS1109/cascata em WorkerController não se reproduziu:
  Node 24 `--check` aprovado e LSP ativo (primary/all) confirmou arquivo limpo.
  Posteriormente a atribuição `this._idleSince ??= now` foi substituída pela
  forma equivalente `if (this._idleSince == null) this._idleSince = now`, para
  compatibilidade com o parser que originava o aviso de cascata. CommonJS foi
  preservado. Sintaxe Node 24 e 27/27 testes de base/abrigo/progresso aprovados
  após essa mudança equivalente; a suíte completa 784/784 precedeu esse ajuste.
- Diff de whitespace: aprovado com tratamento CRLF; sem staging indiscriminado.

Na última rodada, processo iniciado às 15:39Z ainda tinha HP baixo herdado e
morreu por zumbi às 15:41:13Z. **A recuperação automática pós-morte foi observada**:
spawn às 15:41:14Z, meta `picareta de madeira` retomada automaticamente e
inventário passou de vazio para `oak_log:1`. Snapshot: HP/fome 20/20,
posição aproximada (5.45,68,7.27), tarefa `picareta de madeira`.
A picareta ainda não estava comprovada nesse snapshot; sem nova entrega de
ferro, alimentação ou construção certificada. Não inventar conclusão posterior.

### Confirmação física posterior de ferramentas (15:46Z)

O observador recebeu `[autônomo] picareta de madeira: fiz wooden_pickaxe`.
Snapshot independente confirmou no inventário real: `wooden_pickaxe:1`,
`stone_pickaxe:1`, `stone_sword:1` e `cobblestone:1`. Meta atual:
`machado de pedra`. Main conectado perto de (-91.5,64,-44.7), HP 4.83/20,
fome 14/20, sem workers. Ferramentas físicas comprovadas; sobrevivência ainda
frágil. A queda de HP não deve ser ocultada por progresso de crafting.

O log registra coleta de 4 pedras na meta de machado, mas o machado ainda não
foi confirmado no snapshot. Há transferências automáticas de carga após metas;
a releitura independente do baú continua pendente, sem certificação de entregas.

Novos erros reais observados no autoeat: timeout de 3000ms e item trocado cedo
para undefined durante a rodada de crafting. Próxima prioridade: arbitragem
entre alimentação, troca de item/crafting e produção com HP baixo. Não afirmar
alimentação recuperada nem autonomia estável. Evidência privada:
`logs/live-resume-20261028/autonomous-tools-confirmed.json`.
O bot permanece rodando com autonomia determinística; nenhum servidor alterado.

## Prioridade seguinte — arbitragem entre comer, trocar item e fabricar

Conflito observado no jogo em 15:45Z, durante a fabricação de ferramentas:
`Eating timed out with a time of 3000 milliseconds!` e
`Item switched early to: undefined! Item: null`, ambos do mineflayer-auto-eat.
Causa: o AutoEat troca o item da mão por conta própria (a cada physicsTick)
no meio de `bot.craft`/`furnace.putInput`, e o craft também equipa itens.

Correção localizada:

- Novo `lib/item-lock.js`: uma operação exclusiva de item/inventário por vez.
  Chamadas aninhadas (craft → ingrediente → craft) entram direto; chamadas
  concorrentes esperam a anterior. Ao adquirir, espera até 4s uma refeição em
  andamento terminar (cancelar no meio desperdiça comida), desliga o AutoEat e
  o religa ao final, inclusive em erro, somente se estava ativo antes.
- `lib/craft.js`: `craftItem` e `smeltItem` passaram a ser as entradas com trava
  (`craftPlan`/`smeltPlan` mantêm o corpo original).
- `lib/food.js`: `eat` também segura o item antes de equipar/comer.
- Comportamento sem AutoEat e sem plugin continua igual.

Sete regressões novas em `test/item-lock.test.js`; cinco falhavam antes da
correção e as sete passam depois: pausa/retomada no sucesso e no erro, craft
aninhado sem liberar cedo, duas operações concorrentes serializadas, espera de
refeição em andamento, refeição com AutoEat ativo e funcionamento sem plugin.

Suíte final: sintaxe em **91 arquivos** e **791/791 testes**. Evidências:
`logs/live-resume-20261028/item-lock-*.log`.

### Compatibilidade do parser (alertas de cascata)

O analisador estático tratava operadores lógicos de atribuição (`||=`, `??=`)
como erro de sintaxe (TS1109), embora o Node 24 os aceite. Substituídos por
formas equivalentes explícitas em `core/WorkerController.js` (5 ocorrências),
`lib/world-memory.js`, `lib/world-observer.js` e `lib/julia-authority.js`.
Nenhuma mudança de comportamento; a suíte 791/791 acima já cobre esses caminhos.
O script em `docs/evidence/natural-terrain-night-death-1201/scripts/outcrop.js`
foi mantido como está: é artefato histórico de evidência, não código do bot.

### Estado físico após recarregar (16:02Z)

Processo reiniciado só no bot, spawn em `ficar` e `!autonomo` reenviado.
HP 4.8/20, fome 6/20, inventário: dirt 2, stone_sword, stone_pickaxe,
wooden_pickaxe. Primeira meta automática: `estoque de comida`.
Nos primeiros ~90s de observação **não houve novo erro do AutoEat** nem
mensagem `Item switched early`. Isso é apenas ausência de falha nessa janela:
não prova recuperação de fome, nem estabilidade de sobrevivência, nem
entrega de comida. A vida continua crítica e a validação prossegue.

Processo final desta etapa: task `64584acf-9230-4e44-b6fa-d94cea8a401e`,
launcher controlado com `MBOT_START_MODE=ficar`; autonomia habilitada por comando.
Observação limitada da conclusão de ferramenta permanece pendente.

Evidências privadas adicionadas em `logs/live-resume-20261028/`:
`controlled-spawn.json`, `first-autonomy-failure.json`,
`flee-replanning-failure.json`, `autonomous-respawn-and-wood.json`,
`final-784-tests.log`, `survival-regressions.log`.
Não publicar snapshots/logs. A PR e a releitura independente após o depósito
histórico continuam pendentes; autonomia ativa não certifica essas entregas.

## Estado do personagem e entregas em baú (28/10, tarde)

O dono ajustou o servidor: bot em **creative/god** e recebeu 26 bolos. Com isso a
sobrevivência deixou de ser o gargalo; surgiu um novo bloqueio real.

### Modo sem medo (opt-in, reversível)

`MBOT_FEARLESS=1` desliga fuga, reação automática a hostis e abrigo noturno
cavado (que alterava o terreno). Sem a variável, o comportamento antigo volta
igual. Ataque manual (`!atacar`) continua disponível. Implementado em
`lib/fear-mode.js` com testes; aplicado em três pontos de `index.js`.

### Comandos novos

| Comando | Efeito |
| --- | --- |
| `!trigo [qtd]` | Junta sementes (baú → capim, andando quando não há), fabrica enxada, ara, planta, espera e colhe. Reconhece plantação existente em vez de recolher sementes de novo. |
| `!pao [qtd]` | 3 trigos por pão. |
| `!guardar [item] [qtd]` | Deposita no baú central (apelidos como `bolo`). |
| `!dar <item> [qtd] [mao]` | Leva ao baú de entrega, criando-o se faltar; `mao` entrega na mão. |
| `!bau` | Cria o baú de entrega onde o bot está e passa a usá-lo. |
| `!bloco <x> <y> <z>` | Diagnóstico: o que o cliente vê naquele bloco. |
| `!lapis [qtd]` | Lápis descendo em degraus validados. |

Retomada dentro da mesma sessão: tarefa cancelada por combate/abrigo volta com
espera crescente (30 s, 1 min … 5 min, até 6 tentativas).

### Evidência física do trigo

- 72 capins quebrados → 9 sementes (≈1/8, coerente), **25 canteiros arados e 9
  plantados**; trabalho interrompido por combate antes da colheita.
- Antes da correção, `capim quebrado: 0` com capim por perto: o `gather`
  descartava esses blocos porque a semente cai por probabilidade e não está na
  tabela de drops. Corrigido com quebra direta (`breakGrassForSeeds`).

### Bloqueio de contêiner/colocação no servidor

- `!dar bolo 24` no ponto -241,64,-11: baú fabricado a partir de tábuas do
  estoque, bot caminhou até (-214,45,-11), depois (-241,64,-11), e a colocação
  falhou **3 vezes** com `Event blockUpdate … did not fire within timeout`.
- `!bloco -241 64 -11` a partir da base: **chunk não carregado** (fora da
  distância de visão), então não é possível confirmar por leitura à distância.
- `!guardar bolo 24` e `!calcular`/`!dar` no baú central (-92,65,-47): tarefa
  executa, **mas nada sai do inventário** e nenhum erro é registrado. O baú é
  legível (`cake: 5`, 19 tipos).
- Conclusão honesta: o fluxo do bot está implementado e testado (depósito
  confirmado nas duas pontas em teste), mas **este servidor recusa interação de
  contêiner/colocação** nesses pontos — compatível com proteção de área/Lockette.
  Sem liberar o baú (ou um local de construção), não há prova física possível.

### Verificação

Sintaxe: 96 arquivos. Suíte: **856/856** (com 19 testes de entrega/baú, 19 de
trigo, 5 de modo sem medo, 6 de retomada).

## Comandos novos registrados a pedido do dono

| Comando | Efeito |
| --- | --- |
| `!lapis [qtd]` | Minera lápis em profundidade (desce cavando degraus validados) e confirma pelo item no inventário. Padrão: 64. |
| `!dar <item> [qtd]` | Leva o item ao baú de entrega em **-241, 64, -11**, deposita e confirma nas duas pontas (mochila e contêiner). Padrão: 64. |
| `!dar <item> [qtd] mao` | Entrega na mão do dono, quando ele está por perto. |
| `!entregar` | Apelido de `!dar`. |

Apelidos aceitos: `lapis`/`lápis` -> `lapis_lazuli`, `ferro`, `ouro`, `carvao`,
`madeira`, `pedra`. O endereço do baú fica em `deliveryChest` no estado
isolado; padrão -241,64,-11.

### Desligar quando os outros forem dormir

- Detecta pedido no chat (`dormir`, `boa noite`, `sleep`...) de jogador que não
  seja o bot ou worker, e jogadores deitados (estado `sleeping` ou sobre bloco
  de cama), verificado a cada 2 s.
- Ao detectar: avisa no chat, salva estado, para os workers e sai com código 0,
  para o supervisor não reconectar enquanto o dono dorme.
- `MBOT_SLEEP_DISABLE=0` desativa; `!parar` e `!ficar` limpam a tarefa pendente.

### Retomar a tarefa depois

- `!lapis`/`!dar` em andamento gravam `resumeTask` (com horário) no estado.
- No próximo início, se ninguém dorme e o registro tem menos de 6 h, o bot
  avisa e retoma a mesma tarefa; se ainda houver alguém dormindo, adia.
- Ao concluir, o registro é limpo; autonomia nunca é retomada por esse caminho.

### Verificação desta etapa

- Sintaxe: **95 arquivos**. Suíte completa: **823/823 testes** (era 791).
- 32 testes novos: entrega no baú (baú no ponto, variante barrel, baú ausente,
  depósito confirmado nas duas pontas, cancelamento), entrega na mão, degraus
  (lava/água, cabeça bloqueada, escolha de direção, fundo, cancelamento,
  limites), detecção de sono (chat, cama, ignorar bot/workers, erro de
  `blockAt`) e retomada (registro, adiamento, expiração, descrição).
- **Nada disso foi validado fisicamente no servidor**: o bot foi desligado a
  pedido do dono para dormir. Pendente em jogo: existência do baú em
  -241,64,-11, depósito real, mineração de lápis, e o ciclo desligar/religar
  com retomada.

### Meta de cama desativada (pedido do dono)

O log mostrou ciclos repetidos de `[cama] procurando ovelha` — tempo gasto sem
resultado. Como o bot agora detecta que os jogadores vão dormir e se desliga
(`lib/sleep-watch`), a cama deixou de ser necessária para ele.

- `lib/autonomy.js`: a meta `cama` passou a ser **opt-in**
  (`enabled: () => process.env.MBOT_BED_GOAL === '1'`) e `Autonomy.goals()`
  filtra metas desativadas. Padrão: fora da lista, sem caçar ovelha, sem contar
  como pendência no progresso.
- `test/autonomy-bed.test.js`: 4 regressões (ausente por padrão, outras metas
  intactas, presente com a variável, nunca escolhida quando desativada).
- Sintaxe: 95 arquivos. Suíte: **827/827 testes**.
- Observado no jogo após reiniciar: autonomia ativa sem nenhuma mensagem de
  procura de ovelha; bot em `passar a noite` (cavando abrigo), HP 20/20 e fome
  6/20. Fome ainda baixa: alimentação continua pendente.

## Comandos `!trigo` e `!pao` (plantar, colher e fazer pão)

| Comando | Efeito |
| --- | --- |
| `!trigo [qtd]` | Junta sementes quebrando capim, fabrica enxada se faltar, ara canteiros perto de onde está, planta, colhe o que já estiver maduro, espera amadurecer (até 25 min) e colhe. Padrão: 24 trigos. |
| `!pao [qtd]` | Faz pão com o trigo disponível (3 trigos por pão). Padrão: 8 pães. |

- `lib/farm.js`: `ensureHoe`, `collectSeeds`, `plantArea`, `harvestRipe`,
  `waitRipe`, `wheatNeededFor`. Só colhe trigo com `age >= 7`; canteiro exige
  terra arável com espaço livre em cima; nada é creditado por aceite de API.
- Retomada: `trigo` e `pao` também entram em `resumeTask`, então o desligamento
  por sono não perde a tarefa.
- 13 regressões em `test/farm.test.js` (cálculo de pão, classificação de terra,
  enxada existente/fabricada/ausente, sementes com e sem alvo, arar+plantar,
  bloqueio por bloco em cima, colheita só madura, cancelamento, espera com
  sucesso e com prazo estourado).
- Sintaxe: **96 arquivos**. Suíte: **840/840 testes**.
- Ainda **sem validação física**: o trigo depende do tempo do mundo, então o
  ciclo completo só se comprova em jogo, com a plantação crescendo.

### Desligamento por sono comprovado no jogo

Durante a rodada real, o log registrou exatamente o fluxo pedido:
`[sono] Eduardo quer dormir; desligando.` seguido de
`Conexão encerrada (disconnect.quitting)` e saída do supervisor com código 0.
O bot ficou desligado, como deve, para a noite passar. Esta é a primeira
comprovação física desse comportamento; a retomada automática no próximo
início segue coberta por teste, ainda sem nova rodada real.

