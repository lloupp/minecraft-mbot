'use strict';

// Read-only bridge to the real Mineflayer orchestrator and BotManager.
// Never dispatches gameplay commands or changes Julia's shadow authority.
function createRuntimeAdapters({ mainBot, botManager, mainName }) {
  if (!mainBot || !botManager || typeof botManager.list !== 'function') throw new TypeError('runtime dependencies required');
  const snapshot = () => [
    { id: mainName, role: 'orquestrador', status: mainBot.entity ? 'conectado' : 'desconectado' },
    ...botManager.list().map(worker => ({
      id: worker.name, role: worker.role, status: worker.status,
      task: worker.task, resource: worker.resource
    }))
  ];
  return {
    listBots: snapshot,
    execute: async ({ botId, command }) => {
      if (command !== 'status') throw new Error('command_not_enabled');
      const found = snapshot().find(bot => bot.id === botId);
      if (!found) throw new Error('bot_not_found');
      return found;
    }
  };
}
module.exports = { createRuntimeAdapters };
