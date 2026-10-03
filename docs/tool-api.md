# Minecraft Tool API (experimental)

The Tool API is an opt-in, loopback-only surface over the validated worker Tool Layer. It never exposes Mineflayer directly.

Start the bot with:

```bash
MBOT_TOOL_API=1 MBOT_TOOL_API_PORT=3091 node index.js
```

The server binds to `127.0.0.1` only.

## Inspect

```bash
curl http://127.0.0.1:3091/health
curl http://127.0.0.1:3091/v1/workers
curl http://127.0.0.1:3091/v1/workers/<worker>/state
curl http://127.0.0.1:3091/v1/workers/<worker>/tools
```

## Execute a validated tool

```bash
curl -X POST http://127.0.0.1:3091/v1/workers/<worker>/tools/gather \
  -H 'content-type: application/json' \
  -d '{"task_id":"real-gather-1","objective":"collect 6 oak logs","args":{"resource":"oak_log","quantity":6}}'
```

All mutating calls pass through worker identity checks, argument validation and task checkpoints before execution.

## Decision benchmark

With decision servers running:

```bash
CONVERSA_DECISION_URL=http://127.0.0.1:8766/v1/minecraft/decision \
JULIA_DECISION_URL=http://127.0.0.1:8767/v1/minecraft/decision \
MBOT_GAUNTLET_OUT=.data/decision-gauntlet.json \
node scripts/decision-gauntlet.js
```

Julia remains shadow-only. The benchmark may simulate a Julia+fallback result, but the Minecraft executor does not grant Julia execution authority.

A successful local/CI benchmark does not validate Minecraft runtime behavior. The final gate must be repeated on a real Java 1.20.1 server and must verify world/inventory effects.
