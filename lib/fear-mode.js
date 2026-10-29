// lib/fear-mode.js
// Modo sem medo (opt-in e reversível): com MBOT_FEARLESS=1 o bot não foge, não
// parte para cima de ameaça por conta própria nem cava abrigo noturno, porque o
// dono o deixou invulnerável no servidor. Sem a variável, tudo volta ao normal.

function fearless(env = process.env) {
  return String(env?.MBOT_FEARLESS ?? '') === '1'
}

// Reagir a ameaça (fugir ou lutar) só faz sentido quando ele pode se machucar.
function shouldEngage({ fearless: flag = fearless(), threat = null } = {}) {
  return !flag && Boolean(threat)
}

// Abrigo noturno cava terreno; invulnerável, não precisa.
function shouldShelter({ fearless: flag = fearless(), isNight = false } = {}) {
  return !flag && Boolean(isNight)
}

// Em criativo/espectador o servidor não deixa mob machucar: mesmo efeito do modo sem medo.
const SAFE_MODES = new Set(['creative', 'spectator'])
// Resistência V (nível 4) zera o dano de mob/queda/explosão: o servidor deixou o bot invencível.
function hasFullResistance(bot) {
  const id = bot?.registry?.effectsByName?.Resistance?.id
  const effect = id != null ? bot?.entity?.effects?.[id] : null
  return Boolean(effect) && (effect.amplifier ?? 0) >= 4
}

function invulnerable(bot, env = process.env) {
  return fearless(env) || SAFE_MODES.has(String(bot?.game?.gameMode || '')) || hasFullResistance(bot)
}

module.exports = { fearless, invulnerable, hasFullResistance, shouldEngage, shouldShelter }
