function createBot(mineflayer, config, overrides = {}) {
  return mineflayer.createBot({ ...config, ...overrides })
}

module.exports = { createBot }
