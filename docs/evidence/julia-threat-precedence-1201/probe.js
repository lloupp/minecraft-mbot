// Instrumentação de teste (fora do repo): registra estado+candidatos de CADA despacho de worker,
// inclusive os de candidato único (que o shadow não loga). Não altera o comportamento.
const fs = require('fs')
const root = '/home/user/minecraft-mbot'
const { WorkerController } = require(root + '/core/WorkerController')
const { realStateSnapshot } = require(root + '/lib/real-state')
const { candidateIntents, immediateSafety, hasFood } = require(root + '/lib/player-loop')
const orig = WorkerController.prototype._observeShadow
WorkerController.prototype._observeShadow = function (task, isCancelled, taskPromise) {
  try {
    const state = realStateSnapshot(this.bot, task, { homeProvider: this.homeProvider, consecutiveFailures: this._shadowFailureStreak })
    const candidates = candidateIntents(state).map((c) => c.id)
    fs.appendFileSync('/tmp/run/probe-dispatch.jsonl', JSON.stringify({
      ts: Date.now(), worker: this.name, task: task.type, candidates, forced: candidates.length === 1,
      immediateSafety: immediateSafety(state), hasFood: hasFood(state),
      state: { consecutiveFailures: state.consecutiveFailures, alternativeRoute: state.alternativeRoute, health: state.health, food: state.food, inventory: state.inventory, nearby: state.nearby, baseKnown: state.baseKnown, baseDistance: state.baseDistance, atBase: state.atBase, threat: state.threat, time: state.time, equippedWeapon: state.equippedWeapon, objective: state.objective }
    }) + '\n')
  } catch (e) { fs.appendFileSync('/tmp/run/probe-dispatch.err', String(e) + '\n') }
  return orig.call(this, task, isCancelled, taskPromise)
}
