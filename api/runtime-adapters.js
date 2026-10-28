'use strict';

// Runtime bridge: only the owner's opt-in HTTP API can dispatch to workers.
// Julia and Laya remain observers, without execution authority.
function createRuntimeAdapters({ mainBot, botManager, mainName, allowActions = false, isAutonomous = () => false }) {
  if (!mainBot || !botManager || typeof botManager.list !== 'function' || typeof botManager.get !== 'function') {
    throw new TypeError('runtime dependencies required');
  }
  if (typeof mainName !== 'string' || !mainName) throw new TypeError('mainName required');
  const reservations = new Set();
  const commands = Object.freeze(allowActions ? ['status', 'stop', 'mine', 'craft', 'move'] : ['status']);
  const snapshot = () => [
    { id: mainName, role: 'orquestrador', status: mainBot.entity ? 'conectado' : 'desconectado' },
    ...botManager.list().map(worker => ({
      id: worker.name, role: worker.role, status: worker.status,
      task: worker.task, resource: worker.resource
    }))
  ];
  const validName = value => typeof value === 'string' && /^[a-z0-9_]{1,48}$/.test(value);
  const validCount = value => Number.isInteger(value) && value >= 1 && value <= 16;
  const failure = code => { throw new Error(code); };
  return {
    commands,
    listBots: snapshot,
    execute: async ({ botId, command, args = {} }) => {
      const found = snapshot().find(bot => bot.id === botId);
      if (!found) failure('bot_not_found');
      if (command === 'status') return found;
      if (!allowActions) failure('command_not_enabled');
      if (botId === mainName) failure('orchestrator_protected');
      if (isAutonomous()) failure('autonomy_active');
      const worker = botManager.get(botId);
      const controller = worker?.bot?.colonyController;
      if (!controller || !worker.bot.entity || !controller.workMoves) failure('bot_not_ready');
      if (command === 'stop') {
        controller.cancel();
        return { botId, cancellationRequested: true };
      }
      if (reservations.has(botId) || !controller.isIdle()) failure('bot_busy');
      let task = null;
      if (command === 'mine' && validName(args.resource) && validCount(args.count)) {
        task = { type: 'coletar_blocos', resource: args.resource, count: args.count };
      } else if (command === 'craft' && validName(args.item) && validCount(args.count)) {
        task = { type: 'fabricar', item: args.item, count: args.count };
      } else if (command === 'move' && [args.x, args.y, args.z].every(Number.isInteger)) {
        const from = worker.bot.entity.position;
        if (!from || Math.hypot(args.x - from.x, args.y - from.y, args.z - from.z) > 16 ||
            Math.abs(args.y - from.y) > 6) failure('target_out_of_range');
        task = { type: 'ir_local', position: { x: args.x, y: args.y, z: args.z } };
      } else {
        failure('invalid_command_args');
      }
      reservations.add(botId);
      try {
        // Call run immediately, not in a deferred microtask: an immediately
        // following stop request must not precede the initial task setup.
        const pending = Promise.resolve(controller.run(task));
        pending.catch(() => {}).finally(() => reservations.delete(botId));
        await Promise.resolve();
        return { botId, accepted: true, task };
      } catch (error) {
        reservations.delete(botId);
        throw error;
      }
    }
  };
}
module.exports = { createRuntimeAdapters };
