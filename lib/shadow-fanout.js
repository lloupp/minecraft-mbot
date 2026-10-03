// lib/shadow-fanout.js
// Combina vários observadores de shadow mode (ex.: Laya e Julia-1) atrás da
// mesma interface `{ enabled(), observe() }` que o WorkerController já usa.
// Cada observador é independente: um que lance não afeta os outros e nada
// retorna ao chamador.

function combineShadows(...observers) {
  const active = () => observers.filter((observer) => observer?.enabled?.())
  return {
    enabled: () => active().length > 0,
    observe(payload) {
      for (const observer of active()) {
        try { observer.observe(payload) } catch { /* um observador nunca afeta os demais nem o runtime */ }
      }
    }
  }
}

module.exports = { combineShadows }
