# Multi-bot Control API (experimental)

This is a **non-running adapter scaffold**. It does not start automatically, connect to Minecraft, or grant Julia authority.

The adapter requires two callbacks: `listBots()` and `execute({botId, command, args})`. They must enforce ownership, bot existence, cancellation, and the runtime's safety gates before dispatching any actual action. Do not expose the server publicly.

Example integration:

```js
const { createControlApi } = require('./api/control-api');
const api = createControlApi({
  token: process.env.MBOT_API_TOKEN,
  listBots: async () => [],
  execute: async () => { throw new Error('Runtime integration not yet implemented'); }
});
await api.listen();
```

Routes:
- `GET /v1/commands`
- `GET /v1/bots`
- `POST /v1/bots/:botId/commands` with `{"command":"status","args":{}}`

The first command allowlist is intentionally limited. **A listed command does not mean it is wired to the runtime.** No WebSocket or MCP server is included yet. Bind to localhost (default); configure a bearer token before enabling remote access. The API uses no additional npm dependencies.

Run `node --test test/control-api.test.js`.
