'use strict';
const http = require('node:http');

function createControlApi({ listBots, execute, token, host = '127.0.0.1', port = 8765 }) {
  if (typeof listBots !== 'function' || typeof execute !== 'function') throw new TypeError('listBots and execute adapters required');
  const commands = Object.freeze(['status', 'stop', 'follow', 'mine', 'craft', 'eat']);
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (token && req.headers.authorization !== `Bearer ${token}`) return reply(401, { error: 'unauthorized' });
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/v1/commands') return reply(200, { commands });
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
      if (!payload || !commands.includes(payload.command) || (payload.args !== undefined && (typeof payload.args !== 'object' || payload.args === null || Array.isArray(payload.args)))) {
        return reply(400, { error: 'invalid_command' });
      }
      const result = await execute({ botId: match[1], command: payload.command, args: payload.args || {} });
      return reply(202, { result });
    } catch (error) {
      return reply(error instanceof SyntaxError ? 400 : 500, { error: error instanceof SyntaxError ? 'invalid_json' : 'adapter_failure' });
    }
  });
  return { server, commands, listen: () => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.removeListener('error', reject); resolve(server.address()); });
  }), close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
module.exports = { createControlApi };
