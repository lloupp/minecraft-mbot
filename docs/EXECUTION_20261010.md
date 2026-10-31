# Ciclo 2026-10-10 — integridade e segurança

## Estado e arquitetura

Base: `experiment/autonomous-player-loop-next`, HEAD `49ea01e2971cbc957edec989115931d2d96261f4` (PR #88). A PR #78 foi substituída; #89 mantém o experimento de recuperação semântica separado. Node.js/CommonJS + Mineflayer Java 1.20.1: `index.js` coordena conexão, dono, comandos e serviços; `WorkerController` executa tarefas; produção, armazenamento, percepção e memória têm módulos próprios. Painel HTTP local para estado/testes. Sem banco remoto obrigatório; estado JSON local.

A evidência anterior continua classificando a autonomia como **parcial**. O código atual inclui autoridade Julia opt-in, além de shadow; este ciclo não altera nem ativa essa autoridade. Nenhuma mudança em main, merge, publicação ou migração.

## Concluído

- Abrigo: revalida terreno e materiais após navegação; revalida coluna restante após equipar; cancelamento após equipar impede novas escavações/colocação. A posição e o bloco observados no mundo continuam prevalecendo sobre o plano.
- WorldMemory: falha de gravação conserva pendência para retry; confirmação/rediscovery de registro já confirmado passa a persistir validade e conteúdo atualizado; snapshot antigo assíncrono não pode sobrescrever salvamento síncrono posterior, inclusive quando só existe gravação pendente.
- Tool API isolada: Host restrito ao loopback/porta real; POST exige origem local quando Origin existe e Content-Type JSON; rejeita JSON não estruturado antes de chamar executor. Clientes nativos locais sem Origin continuam permitidos. Isso não é autenticação de processos locais.

## Evidência

Ver [evidências do ciclo](https://github.com/lloupp/minecraft-mbot/blob/b00cb6d875ed541b04e04bf655a77d8bb7b0fbe1/docs/evidence/shelter-memory-integrity-20261010/README.md). Testes de regressão do abrigo e da memória falham no código base. Smoke dirigido Minecraft real: lava introduzida após navegação causa recusa com zero digs; terreno restaurado permite três escavações, tampa confirmada e saída. Sem modelo, bot sem OP, survival; terreno controlado por console em servidor local descartável e dificuldade peaceful. Não mede sobrevivência natural nem comprova melhoria no soak.

## Backlog priorizado

| Prioridade / classe | Problema → solução | Impacto / esforço | Dependências | Aceite e validação | Estado |
|---|---|---|---|---|---|
| P0 / comprovado | Inspeção do abrigo expira durante awaits → conferir mundo antes da ação | Evita escavação insegura / pequeno | Percepção local | Mudança para líquido e cancelamento: zero nova ação; ciclo físico seguro completo | Concluído |
| P0 / comprovado | Gravação falha perde retry; shutdown pode regredir arquivo → pendência e ordem de publicação | Preserva conhecimento / pequeno | Sistema de arquivos | Falha seguida de retry + writeFile pausado/sync/restart conservam snapshot mais recente | Concluído |
| P1 / comprovado | API aceita Host/origem externa e simple POST → validar cabeçalhos e JSON | Reduz acionamento por páginas externas / pequeno | HTTP local | Requests adversários nunca chegam ao executor; clientes válidos funcionam | Concluído no componente |
| P1 / comprovado | ToolApiServer e minecraftTools não são ligados pelo runtime, apesar da documentação → integrar opt-in com lifecycle e ownership | Automação utilizável / médio | Proteções deste ciclo, camada de ferramentas | Flag desligada: nenhuma porta; ligada: processo → worker → executor → inventário real; shutdown e cancelamento | Concluído no [ciclo API](TOOL_API_RUNTIME_20261010.md) |
| P1 / comprovado em evidência anterior | Abrigo ainda falha em parte dos soaks → reproduzir não chegada/saída em terreno natural | Sobrevivência / médio | Servidor/mundos pareados e tempo de soak | ≥80% sucesso de abrigo, ≥2/3 noites sem morte; comparação pareada sem escolher só sucessos | Planejado, não iniciado |
| P2 / comprovado no código | load da WorldMemory não aplica caps; arquivo não distingue mundos → limites na leitura e identidade de mundo | Memória/isolamento / médio | Definir identidade estável sem perder dados | Arquivo grande respeita caps; troca de servidor não reutiliza sugestões indevidas; arquivo anterior preservado | Planejado, não iniciado |
| P2 / risco provável | Owner automático escolhe primeiro jogador; endpoints legados com CORS aberto → revisar política para servidor compartilhado | Permissões / médio | Modelo de confiança | Dois jogadores e origens externas exercitam acesso permitido/negado | Planejado, não iniciado |
| P3 / oportunidade | WorkerController/index concentram responsabilidades → extração gradual por fluxo | Manutenção / grande | Fluxos físicos estabilizados | Mesma evidência de navegação/preparação/ownership antes e depois | Não iniciado |

Atualização: integração da Tool API concluída no [ciclo seguinte](TOOL_API_RUNTIME_20261010.md), com o index.js e Minecraft 1.20.1 reais. Próxima prioridade: soak pareado em terreno natural e validação física com dois workers; os testes dirigidos não comprovam sobrevivência sustentada.
