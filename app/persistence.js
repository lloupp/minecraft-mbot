// app/persistence.js
// Salva o estado da colônia (debounce de 250 ms para mudanças e um salvamento
// periódico). `companionAuto` é lido na hora: o companheiro nasce depois.

function createPersistence({ stateStore, storage, colony, waypointManager, botManager, projectManager, companionAuto }) {
  async function persistState() {
    await stateStore.save({
      // Mantém campos legados vazios; a posição vive em waypoints.base.
      home: null,
      homeDimension: null,
      storage: storage.getPosition(),
      auto: colony.auto,
      companionAuto: companionAuto(),
      waypoints: waypointManager.exportState(),
      // Escala pretendida, não só quem está online: se o servidor cair, os workers
      // caem antes do orquestrador salvar e a colônia se perderia no estado.
      workers: botManager.rosterCounts(),
      project: projectManager.exportState(),
      animalTargets: colony.animalTargetsSnapshot()
    })
  }

  let persistTimer = null
  function persistSoon() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      persistState().catch((err) => console.log(`[estado] não consegui salvar: ${err.message}`))
    }, 250)
    persistTimer.unref?.()
  }

  function startPeriodic(ms = 15000) {
    setInterval(() => persistState().catch(() => {}), ms).unref?.()
  }

  return { persistState, persistSoon, startPeriodic }
}

module.exports = { createPersistence }
