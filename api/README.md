# Multi-bot Control API (experimental, opt-in)

The API is connected to the **existing** Mineflayer `BotManager` and `WorkerController`.
It does not start automatically. Julia and Laya remain in shadow mode without execution authority.
The HTTP server listens on **127.0.0.1** by default; do not expose it to untrusted networks.

## Read-only mode (default when enabled)

```bash
MBOT_CONTROL_API=1 npm start
curl http://127.0.0.1:8765/v1/commands
curl http://127.0.0.1:8765/v1/bots
```

Only `status` is advertised and executable. No action can modify the world.

## Explicit worker actions

Set a strong, private token and opt in to actions:

```bash
MBOT_CONTROL_API=1 MBOT_API_ACTIONS=1 MBOT_API_TOKEN='replace-with-long-random-secret' npm start
```

```bash
curl -H "Authorization: Bearer $MBOT_API_TOKEN" http://127.0.0.1:8765/v1/bots
curl -X POST -H "Authorization: Bearer $MBOT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command":"mine","args":{"resource":"oak_log","count":3}}' \
  http://127.0.0.1:8765/v1/bots/minerador_01/commands
```

The caller should export `MBOT_API_TOKEN` in its own shell. Do not commit secrets.
`MBOT_API_PORT` may override port 8765. If action opt-in is requested without a token,
actions stay disabled.

## Endpoints

- `GET /v1/commands` — commands actually enabled in the current mode
- `GET /v1/bots` — main bot and workers (IDs, roles, states and tasks)
- `POST /v1/bots/:botId/commands` — JSON `{"command":"status","args":{}}`

Available commands in action mode (for **workers only**):

| Command | Arguments | Behavior |
|---|---|---|
| `status` | `{}` | Returns the individual bot snapshot |
| `move` | `{"x":1,"y":64,"z":2}` | Go to coordinates within 16 blocks, at most 6 vertically |
| `mine` | `{"resource":"oak_log","count":3}` | Collect blocks; count 1–16 |
| `craft` | `{"item":"stick","count":2}` | Call existing production/crafting; count 1–16 |
| `stop` | `{}` | Request cancellation of the addressed worker task |

All commands use the existing worker logic. The main orchestrator cannot be directed
via this write API. API tasks are rejected when the autonomous colony is active or
a worker is busy/not ready. Concurrent API submissions to one worker are reserved
and rejected; other workers may process their own commands.

**Important limitations:** HTTP 202 means *accepted*, not verified completion.
`stop` requests cancellation through `WorkerController.cancel()`. Movement and
mining already check cancellation, but some existing crafting/production operations
are not cancellation-aware and may finish despite a stop request. There is not yet
durable task tracking, progress events, per-task ownership arbitration with all
non-API colony schedulers, WebSocket, or MCP integration. Do not enable actions
alongside external schedulers without additional coordination.

HTTP errors: 401 unauthorized, 403 protected command, 404 unknown bot,
409 busy/not ready/autonomy active, 422 invalid arguments or distant target.

## Tests

```bash
node --test test/control-api.test.js test/runtime-adapters.test.js
npm test
```

These are unit tests with synthetic workers; they do not prove movement, mining,
or crafting on a live Minecraft server. Physical integration requires separate
opt-in testing and observing task completion.
