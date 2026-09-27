# Provisionamento Forge e primeiro smoke — 2026-09-27

Base: main `015b15b937a3b85f3088a614895502aad60d188b`.
Servidor criado: `/home/eduardodlima/minecraft/forge-1201-test`, `127.0.0.1:25586`, Forge 47.4.10 / Minecraft 1.20.1, Java 17.0.20.1. Instalador oficial com SHA1 `66bfea9963bfa60d88bab6b2750e74a958392715` validado. Mundo novo natural, survival normal, sem mods adicionais ou itens fornecidos. Somente dono eduardo consta em ops.json.

Log real: ModLauncher `--launchTarget forgeserver --fml.forgeVersion 47.4.10 --fml.mcVersion 1.20.1`. `Done (54.269s)` em 07:08:33 -03. Serviço transitório `mbot-forge-1201-test.service` ativo; heap 256–768 MB. Servidores anteriores não foram interrompidos. Reexecução de setup preservou o mundo; segunda execução de start foi recusada pelo lock.

## Evidência e tentativas

Os arquivos JSON anexos são retratos do executor de sessão, não checkpoints de objetivos.

1. Três bots conectados. Falha do seletor de destino do teste: procurando só em X não encontrou chão seguro para lenhador. Nenhuma conclusão de tarefa.
2. Seletor ampliado para outras direções, sem alterar terreno. Dois workers navegaram simultaneamente. Verificador do teste media distância ao canto do bloco com tolerância 2,5: 2,5495 e 2,2194. Primeiro resultado reprovado, segundo aprovado por aquele verificador. Isso não estabelece um contrato correto de navegação.
3. Distância física medida ao centro do bloco, raio 2 com margem 0,01. WorkerController.run(ir_local) retornou ok=true para ambos, mas distâncias finais foram 2,1030 e 2,1357; ambos **reprovados**. Preservar esse gap para correção mínima em PR própria, sem diluir a tolerância. GoalNear usa coordenadas discretas; um executor que promete raio físico precisa verificar/reaproximar a posição final.

Todos os bots em overworld, survival, vida 20 e comida 20, versão 1.20.1. Desconectados pelo executor ao final. Não houve validação de logística, coleta, produção, construção, combate, cancelamento durante viagem ou retomada após restart.

CPU Node durante navegação + 3 s de observação: tentativa 2, 15,41% de um core em 6,958 s; tentativa 3, 16,18% em 3,908 s. Amostras curtas, sem valor para aprovação de desempenho prolongado; não incluem CPU do servidor ou index.js completo.

## Validação local e review

Shell scripts: bash -n aprovado. whitelist.js e smoke.js: node --check aprovado. npm run check e npm test com Node 22.22.3 via script-shell temporário: 268/268, zero falhas/skips. Instalador e start efetivamente executados no servidor real. Review local conferiu pin/checksum, mundo separado, loopback, limites, OP somente do dono, lock e preservação de arquivos. Não altera dependências nem runtime de produção.

Limitações: memória e EventLog do index.js ainda não possuem isolamento automático por servidor; o smoke não importa esses estados. Serviço transitório não reinicia após reboot. Esta PR entrega o ambiente e o executor de teste; não aprova o P0.
