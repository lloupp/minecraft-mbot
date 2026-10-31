// @ts-check
// app/commands/parse.js

// Quantidade dita no chat, limitada a 1..64.
const parseCount = (arg, fallback = 1) => Math.max(1, Math.min(64, Number.parseInt(arg, 10) || fallback))

module.exports = { parseCount }
