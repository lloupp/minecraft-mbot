# Corrige conexão por .env e alimentação de auxiliares feridos

O início do bot ignorava o `.env`, e uma porta inválida podia levar à tentativa
em outra porta. Auxiliares feridos também não comiam com fome 15–17, mesmo com
alimento disponível, impedindo a regeneração natural. Esta PR corrige esses
comportamentos e preserva a evidência de reprodução e validação.

## Alterações

- Carrega o `.env` do diretório de execução antes de ler as configurações;
  variáveis do processo têm prioridade. Arquivo ausente é permitido; outros erros
  de leitura são propagados.
- Centraliza host, porta, dono e nome em `lib/connection-config.js`.
- Rejeita porta explícita fora de 1–65535 ou malformada; valida host vazio e
  limita a detecção de portas Java ao servidor local.
- Melhora o diagnóstico quando o servidor não responde ao ping de status.
- Faz o auxiliar ferido tentar comer alimento seguro quando a fome está abaixo
  de 18, além do limite anterior de 14. Mantém proteção de consumo simultâneo,
  defesa, escavação e alimentos nocivos.
- Atualiza `.env.example` com nome do bot e anúncio LAN desativado; documenta
  servidor dedicado, inicialização e limitações de autenticação/modpacks.
- Acrescenta regressões para configuração, precedência do ambiente e alimentação.
- Faz o smoke físico usar `.env`, registrar hashes do código e oferecer o cenário
  opt-in `MBOT_SMOKE_RECOVERY=1` para recuperação após dano.
- Faz o soak gravar logs durante a execução, relatórios intermediários, horários,
  duração observada e hashes do código.
- Inclui relatórios e logs dos testes controlados antes/depois e da sessão natural
  interrompida, com as falhas preservadas.

## Validação concluída

- `npm run check`, sintaxe dos harnesses e `git diff --check`: aprovados.
- Testes Node: **722/722**. Testes Python: **13/13**.
- Minecraft Java vanilla 1.20.1 oficial, Java 17, Node 24.22.1, mundos descartáveis,
  bots survival sem OP e servidores apenas em loopback.
- Nove etapas físicas existentes aprovadas: API desligada por padrão, worker
  conectado, coleta com inventário conferido, movimento com posição conferida,
  replay sem repetir coleta, bloqueio de origem externa, busy/stop, encerramento
  por SIGTERM e replay após reinício.
- Recuperação: antes, vida 14/fome 17/quatro pães permaneceram inalterados por
  15 segundos. Depois, o auxiliar consumiu um pão, chegou a fome 20 e começou a
  regenerar vida, observada em 15. Nenhuma ordem `eat` foi enviada.

## Sessão natural e limites

A execução de 40 minutos foi encerrada por solicitação do usuário após
**853,719 segundos (14 min 14 s) da primeira etapa**. O relatório está marcado
`STOPPED_BY_USER`. Foram registradas 428 amostras, vida/fome mínimas 20 nos
auxiliares, zero mortes, zero falhas de abertura do estoque e zero erros
`pos.floored`. O estoque chegou a 69 troncos e quatro tábuas; o bot principal
iniciou abrigo noturno. Falhas de caminho e confirmação de itens continuam nos logs.

**Os 40 minutos não foram concluídos.** A segunda etapa natural não começou.
O cenário de recuperação usa dano, fome e pão preparados pelo console e não
comprova aquisição natural de alimento. A regra de alimentação depende de comida
disponível e não garante sobrevivência prolongada. Não foram validados o servidor
LAN do usuário, autenticação Microsoft ou modpacks. Julia e demais modelos
permaneceram sem autoridade. Não houve merge nem alteração direta da `main`.

Evidências: `docs/evidence/live-readiness-20261027/README.md` e subdiretórios
`recovery-before`, `recovery-after` e `natural-stopped`.
