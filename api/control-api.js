'use strict';
const http = require('node:http');

function createControlApi({ listBots, execute, token, commands = ['status'], host = '127.0.0.1', port = 8765 }) {
  if (typeof listBots !== 'function' || typeof execute !== 'function') throw new TypeError('listBots and execute adapters required');
  const availableCommands = Object.freeze([...commands]);
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (token && req.headers.authorization !== `Bearer ${token}`) return reply(401, { error: 'unauthorized' });
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/v1/commands') return reply(200, { commands: availableCommands });
    if (req.method === 'GET' && url.pathname === '/v1/bots') {
      try { return reply(200, { bots: await listBots() }); } catch { return reply(500, { error: 'adapter_failure' }); }
    }
    const match = /^\/v1\/bots\/([a-zA-Z0-9_-]{1,64})\/commands$/.exec(url.pathname);
    if (req.method !== 'POST' || !match) return reply(404, { error: 'not_found' });
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) return reply(413, { error: 'body_too_large' });
        chunks.push(chunk);
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!payload || !availableCommands.includes(payload.command) || (payload.args !== undefined && (typeof payload.args !== 'object' || payload.args === null || Array.isArray(payload.args)))) {
        return reply(400, { error: 'invalid_command' });
      }
      const result = await execute({ botId: match[1], command: payload.command, args: payload.args || {} });
      return reply(202, { result });
    } catch (error) {
      if (error instanceof SyntaxError) return reply(400, { error: 'invalid_json' });
      const codes = {
        bot_not_found: 404,
        command_not_enabled: 403,
        orchestrator_protected: 403,
        autonomy_active: 409,
        bot_not_ready: 409,
        bot_busy: 409,
        invalid_command_args: 422,
        target_out_of_range: 422
      };
      const code = error?.message;
      return reply(codes[code] || 500, { error: codes[code] ? code : 'adapter_failure' });
    }
  });
  return { server, commands: availableCommands, listen: () => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.removeListener('error', reject); resolve(server.address()); });
  }), close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
module.exports = { createControlApi };
