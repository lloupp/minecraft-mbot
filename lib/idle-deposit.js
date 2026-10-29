// Adapted from PR #95: background deposits must not preempt physical work.
// Cargo reserves remain governed by StorageManager (tools/equipment + food).
function canAutomaticDeposit({ mode, taskName, pausedFollowing = 0, fleeingUntil = 0, now = Date.now(), eating = false, checkingGear = false, isMoving = false } = {}) {
  return (mode === 'seguir' || mode === 'ficar') && taskName == null &&
    pausedFollowing === 0 && fleeingUntil <= now && !eating && !checkingGear && !isMoving
}
module.exports = { canAutomaticDeposit }
