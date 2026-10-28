# Validação real: conexão local e recuperação de auxiliares

Implementação: `f53db80` sobre `d5a06ba68e51b1a44bbadba975505ff7ce083644`.
Minecraft Java vanilla 1.20.1 oficial, Java 17, Node 24.22.1. Mundos descartáveis,
servidores ligados apenas em loopback, bots em survival sem OP. Nenhum arquivo
ou configuração do servidor do usuário foi alterado. Modelos/autoridade Julia desligados.

## Correções e resultados comprovados

- `index.js` carrega o `.env` do diretório de execução antes de ler configuração.
  Variáveis do processo continuam tendo prioridade; ausência de arquivo é permitida,
  mas erro de leitura não é ocultado.
- Uma porta explícita inválida interrompe a inicialização. Servidor remoto sem porta
  usa 25565, sem inspecionar processos Java locais para escolher uma porta remota.
- Auxiliar ferido com fome abaixo de 18 tenta comer alimento seguro disponível;
  antes, só tentava comer quando a fome chegava a 14. Mantidas as proteções de
  consumo simultâneo, defesa, escavação e alimentos nocivos.

`tests-fixed.log.txt`: **722/722 testes Node**. `python-tests.log.txt`: **13/13**.
`npm run check`, `git diff --check` e sintaxe dos dois harnesses aprovados.
`tests-recovery-baseline.log.txt` conserva a regressão antes da correção: um teste
falha porque o auxiliar não come, e a checagem das proteções passa.

## Reprodução física da falha e da correção

Os dois relatórios registram hashes SHA-256 dos arquivos executados. A cópia
`recovery-before` tem o novo carregador de configuração, mas o WorkerController
original; `recovery-after` tem a mudança de recuperação. O servidor prepara
explicitamente fome 17 e vida 14 e fornece quatro pães. Isso é um teste controlado,
não aquisição natural de alimento nem prova de sobrevivência autônoma.

| Evidência | Antes | Depois |
|---|---|---|
| Estado inicial | Vida 14, fome 17 | Vida 14, fome 17 |
| Consumo sem ordem `eat` | Não consumiu em 15 s | Consumiu um pão |
| Estado observado depois | Vida 14, fome 17, quatro pães | Vida 15, fome 20, três pães |
| Resultado do gate | FAIL preservado | PASS |

A versão corrigida passou também nas nove etapas existentes: API desligada por
padrão, worker real, coleta com delta de inventário, movimento com posição conferida,
replay sem nova coleta, bloqueio de origem externa, busy/stop, SIGTERM e replay
após reinício. A conexão em todos esses casos usa o `.env` escrito pelo harness.

```bash
MBOT_TEST_SERVER_JAR=/caminho/server-1.20.1.jar \
MBOT_TEST_EULA_ACCEPTED=1 MBOT_SMOKE_RECOVERY=1 \
node scripts/tool-api-live-smoke.js
```

## Sessão longa

Uma nova execução pareada de 20 minutos por etapa foi iniciada com a versão
corrigida e **encerrada por solicitação do usuário após 853,719 segundos
(14 min 14 s) da primeira etapa**. Os 40 minutos não foram concluídos, a segunda
etapa não começou e o relatório tem status `STOPPED_BY_USER`, sem aprovação global.
Uma execução anterior foi interrompida pela reinicialização do ambiente depois
da primeira etapa; ela não é contabilizada como 40 minutos concluídos.

O harness agora grava o log da aplicação durante a execução, checkpoints do
relatório, horários, duração observada e hashes do código. O cenário natural não
injeta comida/ferramentas/troncos; fornece um baú vazio e configura o spawn.
Os registros parciais estão em `natural-stopped/`: 428 amostras, vida e fome
mínimas de 20 nos auxiliares, zero mortes, zero falhas de abertura de estoque e
zero erros `pos.floored`. O estoque observado chegou a 69 troncos e quatro tábuas,
e o bot principal iniciou abrigo noturno. Falhas de caminho e de confirmação de
itens estão preservadas no log; não foram classificadas como ações bem-sucedidas.
A concorrência/cancelamento têm a validação controlada acima; a etapa natural
dedicada a esses casos não foi executada nesta tentativa. Os processos foram
encerrados e o servidor do usuário não foi acessado.

## Limites

Não há validação do servidor LAN do usuário, autenticação Microsoft, modpacks,
aquisição sustentada de comida ou sobrevivência ilimitada. A nova regra de comer
não cria alimento e não soluciona a escassez. Falhas intermitentes de coleta e
caminho ainda podem ocorrer. Não houve mudança de autoridade de modelos.
