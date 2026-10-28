'use strict';

// Explicit opt-in for mutating commands. Julia/Laya retain shadow-only authority.
function createRuntimeAdapters({ mainBot, botManager, mainName, allowActions = false }) {
  if (!mainBot || !botManager || typeof botManager.list !== 'function' || typeof botManager.get !== 'function') throw new TypeError('runtime dependencies required');
  const snapshot = () => [
    { id: mainName, role: 'orquestrador', status: mainBot.entity ? 'conectado' : 'desconectado' },
    ...botManager.list().map(worker => ({
      id: worker.name, role: worker.role, status: worker.status,
      task: worker.task, resource: worker.resource
    }))
  ];
  const validName = value => typeof value === 'string' && /^[a-z0-9_]{1,48}$/.test(value);
  const validCount = value => Number.isInteger(value) && value >= 1 && value <= 16;
  return {
    listBots: snapshot,
    execute: async ({ botId, command, args = {} }) => {
      const found = snapshot().find(bot => bot.id === botId);
      if (!found) throw new Error('bot_not_found');
      if (command === 'status') return found;
      if (!allowActions) throw new Error('command_not_enabled');
      // The orchestrator retains its own chat-driven authority and cannot be commandeered.
      if (botId === mainName) throw new Error('orchestrator_protected');
      const worker = botManager.get(botId);
      const controller = worker?.bot?.colonyController;
      if (!controller || !worker.bot.entity) throw new Error('bot_not_ready');
      if (command === 'stop') {
        controller.cancel();
        return { botId, cancelled: true };
      }
      if (!controller.isIdle()) throw new Error('bot_busy');
      let task;
      if (command === 'mine' && validName(args.resource) && validCount(args.count)) {
        task = { type: 'coletar_blocos', resource: args.resource, count: args.count };
      } else if (command === 'craft' && validName(args.item) && validCount(args.count)) {
        task = { type: 'fabricar', item: args.item, count: args.count };
      } else if (command === 'move' && [args.x, args.y, args.z].every(Number.isInteger)) {
        const from = worker.bot.entity.position;
        const distance = Math.hypot(args.x - from.x, args.y - from.y, args.z - from.z);
        if (distance > 16 || Math.abs(args.y - from.y) > 6) throw new Error('target_out_of_range');
        task = { type: 'ir_local', position: { x: args.x, y: args.y, z: args.z } };
      } else {
        throw new Error('invalid_command_args');
      }
      // Reserve the worker synchronously before the async controller.run starts.
      // Do not cancel a pre-existing task to force a new one.
      const pending = Promise.resolve().then(() => controller.run(task));
      pending.catch(() => {});
      return { botId, accepted: true, task };
    }
  };
}
module.exports = { createRuntimeAdapters };
