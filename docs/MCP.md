# Servidor MCP (opcional)

`scripts/mcp-server.js` deixa um cliente MCP (Claude Code, Claude Desktop ou
outro) controlar os workers da colônia. É **opcional e desligado por padrão**:
nada muda para quem não o configura, e ele não acrescenta dependências.

O servidor MCP não fala com o Minecraft. Ele só repassa para a
[Tool API](tool-api.md) local, que continua responsável por validar
argumentos, conferir a identidade do worker, reservar o worker ocioso e gravar
checkpoints. Só workers auxiliares são controláveis; o bot principal e o
dono não passam por aqui.

## Ligar

1. Rode o bot com a Tool API:

   ```bash
   MBOT_TOOL_API=1 npm start
   ```

2. Registre o servidor MCP no cliente.

   Claude Code:

   ```bash
   claude mcp add minecraft -- node /caminho/para/minecraft-mbot/scripts/mcp-server.js
   ```

   Claude Desktop (`claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "minecraft": {
         "command": "node",
         "args": ["/caminho/para/minecraft-mbot/scripts/mcp-server.js"]
       }
     }
   }
   ```

Se a Tool API usa outra porta, passe `MBOT_TOOL_API_URL`
(padrão `http://127.0.0.1:3091`) no ambiente do servidor MCP.

## Ferramentas

| Ferramenta | Faz | Muda o mundo |
|---|---|---|
| `list_workers` | Lista workers, papel, conexão e ações | não |
| `worker_state` | Vida, fome, posição, inventário, tarefa | não |
| `worker_gather` | Coleta `quantity` de `resource` e confere o inventário | sim |
| `worker_craft` | Fabrica `quantity` de `item` | sim |
| `worker_move_to` | Vai até `x, y, z` | sim |
| `worker_eat` | Come | sim |
| `worker_deposit` / `worker_withdraw` | Estoque central | sim |
| `worker_stop` | Cancela a tarefa atual | sim |

As ações que mudam o mundo aceitam `task_id`: repetir a chamada com o mesmo ID
devolve o resultado guardado em vez de executar de novo. Sem `task_id`, o
servidor MCP gera um.

Erros da Tool API (worker ocupado, argumento inválido, API fora do ar) voltam
como resultado de ferramenta com `isError: true`, para o modelo ler e decidir.

## Segurança

- A Tool API só escuta em `127.0.0.1` e recusa `Host`/`Origin` externos.
- O servidor MCP roda como processo local do cliente (stdio); não abre porta.
- Quem tem o cliente MCP tem o mesmo poder de quem roda `curl` na máquina:
  não ligue a Tool API numa máquina compartilhada.
