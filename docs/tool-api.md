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

All mutating calls pass through worker identity checks, argument validation and durable task checkpoints before execution. Only an idle, healthy worker can be reserved. A second request or a colony task cannot claim that reservation while the checkpoint is saving. Owner commands, defense, death and disconnect invalidate it; the API does not silently replace a running task. Use `stop` to cancel explicitly.

The runtime attaches the layer to both restored and newly created workers. It starts no listener or checkpoint I/O when `MBOT_TOOL_API=0` (the default). An invalid checkpoint file or occupied port disables the optional API and leaves the Minecraft session running; the invalid file is preserved. Check startup logs before using the endpoint.

`MBOT_TASK_CHECKPOINT_FILE` defaults to `.data/task-checkpoints.json`. Give each mutating request a stable, unique `task_id` to make retries idempotent: terminal requests replay their stored result, mismatched arguments reject reuse, and interrupted tasks require explicit recovery rather than automatic re-execution. Omitted IDs are generated, but a response lost before the ID is received cannot be retried safely by that generated ID.

HTTP clients must use `localhost` or `127.0.0.1` at the actual bound port, send JSON objects, and supply a local Origin if they supply one. External browser origins and simple form/text requests are rejected. This API trusts native processes on the local computer; it does not authenticate arbitrary local programs or expose a remote service.

Disconnect/removal detaches that worker's layer. SIGINT/SIGTERM and main-bot disconnect close HTTP connections and cancel API-owned actions. Shutdown waits briefly for actions/checkpoints to settle; still-running checkpoints are treated as interrupted at the next startup. Already submitted physical actions such as crafting cannot be rolled back.

## Decision benchmark

With decision servers running:

```bash
CONVERSA_DECISION_URL=http://127.0.0.1:8766/v1/minecraft/decision \
JULIA_DECISION_URL=http://127.0.0.1:8767/v1/minecraft/decision \
MBOT_GAUNTLET_OUT=.data/decision-gauntlet.json \
node scripts/decision-gauntlet.js
```

The Tool API dispatches only to the deterministic worker executor. It does not call Julia or change model authority. This experimental branch also contains a separate Julia-authority opt-in; leave `MBOT_JULIA_AUTHORITY=0` when testing this API. Decision benchmarks do not grant API permissions.

A successful local/CI benchmark does not validate Minecraft runtime behavior. The final gate must be repeated on a real Java 1.20.1 server and must verify world/inventory effects.

## Repeat the real runtime smoke

Use a Minecraft Java 1.20.1 server JAR you are permitted to run, Java 17 and the installed Node dependencies:

```bash
MBOT_TEST_SERVER_JAR=/absolute/path/server-1.20.1.jar \
MBOT_TEST_EULA_ACCEPTED=1 node scripts/tool-api-live-smoke.js
```

The harness creates a disposable world and runs the actual `index.js` process. It checks default-off, worker attachment, HTTP collection/inventory and movement/position, replay, busy/stop, blocked external origin, shutdown and replay after restart. It supplies controlled terrain through the server console, uses survival/peaceful, and leaves evidence in the printed temporary directory. This is a directed integration test, not a natural survival soak. No existing world or production process is modified.
