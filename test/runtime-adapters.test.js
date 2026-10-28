'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRuntimeAdapters } = require('../api/runtime-adapters');

function fixture({ allowActions = true, automatic = false } = {}) {
  const operations = [];
  const finish = new Map();
  const workers = new Map();
  for (const name of ['minerador_01', 'artesao_01']) {
    const controller = {
      workMoves: {},
      isIdle: () => true,
      cancel: () => operations.push({ name, cancelled: true }),
      run: task => {
        operations.push({ name, task });
        return new Promise(resolve => finish.set(name, resolve));
      }
    };
    workers.set(name, { bot: { entity: { position: { x: 0, y: 64, z: 0 } }, colonyController: controller } });
  }
  const botManager = {
    list: () => [...workers.keys()].map(name => ({ name, role: name.split('_')[0], status: 'ativo', task: null, resource: null })),
    get: name => workers.get(name) || null
  };
  const adapter = createRuntimeAdapters({
    mainBot: { entity: {} }, botManager, mainName: 'eduardo_bot',
    allowActions, isAutonomous: () => automatic
  });
  return { adapter, operations, finish, workers };
}

test('read-only runtime exposes bot identifiers without leaking internal instances', async () => {
  const { adapter, operations } = fixture({ allowActions: false });
  const bots = adapter.listBots();
  assert.equal(bots.length, 3);
  assert.equal(bots[1].id, 'minerador_01');
  assert.equal(JSON.stringify(bots).includes('position'), false);
  assert.deepEqual(adapter.commands, ['status']);
  assert.deepEqual(await adapter.execute({ botId: 'minerador_01', command: 'status' }), bots[1]);
  await assert.rejects(adapter.execute({ botId: 'minerador_01', command: 'mine' }), /command_not_enabled/);
  await assert.rejects(adapter.execute({ botId: 'missing', command: 'status' }), /bot_not_found/);
  assert.equal(operations.length, 0);
});

test('tasks reserve only the addressed worker and stop cancels that worker', async () => {
  const { adapter, operations, finish } = fixture();
  const accepted = await adapter.execute({ botId: 'minerador_01', command: 'mine', args: { resource: 'oak_log', count: 3 } });
  assert.equal(accepted.accepted, true);
  assert.equal(operations[0].task.type, 'coletar_blocos');
  await assert.rejects(adapter.execute({ botId: 'minerador_01', command: 'craft', args: { item: 'stick', count: 2 } }), /bot_busy/);
  await adapter.execute({ botId: 'artesao_01', command: 'craft', args: { item: 'stick', count: 2 } });
  assert.equal(operations[1].task.type, 'fabricar');
  await adapter.execute({ botId: 'minerador_01', command: 'stop' });
  assert.deepEqual(operations[2], { name: 'minerador_01', cancelled: true });
  finish.get('minerador_01')();
  finish.get('artesao_01')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await adapter.execute({ botId: 'minerador_01', command: 'move', args: { x: 2, y: 64, z: -1 } })).accepted, true);
  finish.get('minerador_01')();
});

test('safety gates reject invalid inputs, automatic mode and orchestrator control', async () => {
  const { adapter, operations } = fixture();
  await assert.rejects(adapter.execute({ botId: 'eduardo_bot', command: 'mine', args: { resource: 'stone', count: 1 } }), /orchestrator_protected/);
  await assert.rejects(adapter.execute({ botId: 'minerador_01', command: 'mine', args: { resource: '../x', count: 1 } }), /invalid_command_args/);
  await assert.rejects(adapter.execute({ botId: 'minerador_01', command: 'craft', args: { item: 'stick', count: 100 } }), /invalid_command_args/);
  await assert.rejects(adapter.execute({ botId: 'minerador_01', command: 'move', args: { x: 200, y: 64, z: 1 } }), /target_out_of_range/);
  assert.equal(operations.length, 0);
  const active = fixture({ automatic: true });
  await assert.rejects(active.adapter.execute({ botId: 'minerador_01', command: 'stop' }), /autonomy_active/);
  assert.equal(active.operations.length, 0);
});
