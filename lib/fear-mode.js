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

module.exports = { fearless, shouldEngage, shouldShelter }
