'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRuntimeAdapters } = require('../api/runtime-adapters');

test('runtime adapter lists main and workers without leaking Mineflayer instances', async () => {
  const bot = { entity: { position: { x: 1, y: 2, z: 3 } } };
  const manager = { list: () => [{ name: 'minerador_01', role: 'minerador', status: 'ativo', task: 'mine', resource: 'stone' }] };
  const adapter = createRuntimeAdapters({ mainBot: bot, botManager: manager, mainName: 'eduardo_bot' });
  const bots = await adapter.listBots();
  assert.equal(bots.length, 2);
  assert.equal(bots[1].id, 'minerador_01');
  assert.equal(JSON.stringify(bots).includes('position'), false);
  assert.deepEqual(await adapter.execute({ botId: 'minerador_01', command: 'status' }), bots[1]);
  await assert.rejects(adapter.execute({ botId: 'minerador_01', command: 'mine' }), /command_not_enabled/);
  await assert.rejects(adapter.execute({ botId: 'missing', command: 'status' }), /bot_not_found/);
});
