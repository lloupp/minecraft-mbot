'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createControlApi } = require('../api/control-api');

test('API exposes bots and validates commands without executing unknown actions', async () => {
  const calls = [];
  const api = createControlApi({ port: 0, listBots: () => [{ id: 'worker1' }], execute: action => { calls.push(action); return { accepted: true }; } });
  const address = await api.listen();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const bots = await fetch(base + '/v1/bots');
    assert.deepEqual((await bots.json()).bots, [{ id: 'worker1' }]);
    const bad = await fetch(base + '/v1/bots/worker1/commands', { method: 'POST', body: JSON.stringify({ command: 'shell' }) });
    assert.equal(bad.status, 400);
    assert.equal(calls.length, 0);
    const ok = await fetch(base + '/v1/bots/worker1/commands', { method: 'POST', body: JSON.stringify({ command: 'status' }) });
    assert.equal(ok.status, 202);
    assert.deepEqual(calls, [{ botId: 'worker1', command: 'status', args: {} }]);
  } finally { await api.close(); }
});

test('API token protects reads and writes', async () => {
  const api = createControlApi({ port: 0, token: 'secret', listBots: () => [], execute: () => null });
  const address = await api.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/bots`);
    assert.equal(response.status, 401);
  } finally { await api.close(); }
});
