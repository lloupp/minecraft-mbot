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

test('command discovery reflects enabled actions and maps adapter errors to HTTP status', async () => {
  const api = createControlApi({
    port: 0, token: 'test-token', commands: ['status', 'move', 'mine', 'craft', 'stop'],
    listBots: () => [{ id: 'worker1' }],
    execute: async ({ command }) => {
      if (command === 'move') throw new Error('target_out_of_range');
      if (command === 'mine') throw new Error('bot_busy');
      if (command === 'craft') throw new Error('autonomy_active');
      return { accepted: true };
    }
  });
  const address = await api.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { authorization: 'Bearer test-token' };
  try {
    const catalogue = await fetch(base + '/v1/commands', { headers });
    assert.deepEqual((await catalogue.json()).commands, ['status', 'move', 'mine', 'craft', 'stop']);
    const unauthorized = await fetch(base + '/v1/bots/worker1/commands', {
      method: 'POST', body: JSON.stringify({ command: 'stop' })
    });
    assert.equal(unauthorized.status, 401);
    for (const [command, status] of [['move', 422], ['mine', 409], ['craft', 409]]) {
      const response = await fetch(base + '/v1/bots/worker1/commands', {
        method: 'POST', headers, body: JSON.stringify({ command, args: {} })
      });
      assert.equal(response.status, status);
    }
    const stop = await fetch(base + '/v1/bots/worker1/commands', {
      method: 'POST', headers, body: JSON.stringify({ command: 'stop' })
    });
    assert.equal(stop.status, 202);
  } finally { await api.close(); }
});
