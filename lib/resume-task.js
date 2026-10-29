// lib/resume-task.js
// Guarda a tarefa que estava em andamento quando o bot se desligou para os
// jogadores dormirem e a devolve no próximo início — só se ninguém dorme.

// Só tarefas explícitas do dono entram aqui; autonomia não é retomada.
const KINDS = new Set(['lapis', 'dar', 'trigo', 'pao', 'minerios'])
// Retomada dentro da mesma sessão, depois de um combate cancelar a tarefa.
const MAX_ATTEMPTS = 6
const RETRY_BASE_MS = 30 * 1000
const RETRY_CAP_MS = 5 * 60 * 1000

// Espera crescente entre tentativas: 30s, 1min, ... até 5min.
function retryDelay(attempt) {
  const n = Math.max(1, Number(attempt) || 1)
  return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * n)
}
const MAX_AGE_MS = 6 * 60 * 60 * 1000 // registro velho não é tarefa pendente

function record(task, now = Date.now()) {
  if (!task || !KINDS.has(task.kind)) return null
  return { ...task, at: now }
}

function pending(state) {
  if (!state || typeof state !== 'object' || !KINDS.has(state.kind)) return null
  return state
}

function canResume(state, { sleeping = [], at = Date.now(), maxAgeMs = MAX_AGE_MS } = {}) {
  const task = pending(state)
  if (!task) return { ok: false, reason: 'nenhuma tarefa registrada' }
  if (sleeping.length) return { ok: false, keep: true, reason: 'ainda há jogador dormindo' }
  if (task.at && at - task.at > maxAgeMs) return { ok: false, reason: 'registro antigo demais' }
  return { ok: true, task }
}

// Descrição para o log/chat, sem expor detalhes internos.
function describe(task) {
  const item = pending(task)
  if (!item) return 'nada pendente'
  if (item.kind === 'lapis') return `minerar ${item.target} lápis`
  if (item.kind === 'dar') return `entregar ${item.amount}x ${item.name}`
  if (item.kind === 'trigo') return `plantar e colher ${item.target} trigos`
  if (item.kind === 'pao') return `fazer ${item.breads} pães`
  if (item.kind === 'minerios') return `juntar ${item.target} de cada minério`
  return item.kind
}

module.exports = {
  record, pending, canResume, describe, retryDelay,
  KINDS, MAX_AGE_MS, MAX_ATTEMPTS, RETRY_BASE_MS, RETRY_CAP_MS
}
