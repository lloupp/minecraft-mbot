// Instrumentação de teste (fora do repo, só leitura): estado+candidatos de cada despacho e o desfecho de cada tarefa.
const fs = require('fs')
const root = '/home/user/minecraft-mbot'
const { WorkerController } = require(root + '/core/WorkerController')
const { realStateSnapshot } = require(root + '/lib/real-state')
const { candidateIntents, immediateSafety } = require(root + '/lib/player-loop')
const orig = WorkerController.prototype._observeShadow
let seq = 0
WorkerController.prototype._observeShadow = function (task, isCancelled, taskPromise) {
  const id = ++seq
  const self = this
  try {
    const state = realStateSnapshot(this.bot, task, { homeProvider: this.homeProvider, consecutiveFailures: this._shadowFailureStreak })
    const candidates = candidateIntents(state).map((c) => c.id)
    fs.appendFileSync('/tmp/run/probe-dispatch.jsonl', JSON.stringify({
      type: 'dispatch', id, ts: Date.now(), worker: this.name, task: task.type, resource: task.resource || null, candidates, forced: candidates.length === 1,
      immediateSafety: immediateSafety(state), streak_field_in_worker: this._shadowFailureStreak,
      state: { consecutiveFailures: state.consecutiveFailures, alternativeRoute: state.alternativeRoute, food: state.food, threat: state.threat, inventory: state.inventory, objective: state.objective, nearby: state.nearby }
    }) + '\n')
  } catch (e) { fs.appendFileSync('/tmp/run/probe-dispatch.err', String(e) + '\n') }
  const rec = (kind, v) => setTimeout(() => fs.appendFileSync('/tmp/run/probe-dispatch.jsonl', JSON.stringify({
    type: 'result', id, ts: Date.now(), worker: self.name, kind, ok: v && v.ok, code: v && (v.code || (v.failure && v.failure.code)) || null, cancelled: v && v.cancelled === true ? true : false,
    error: kind === 'rejected' ? String(v && v.message || v) : undefined, interrupted: isCancelled(), streak_after: self._shadowFailureStreak, evidence: v && v.evidence ? v.evidence : undefined, gathered: v && v.gathered
  }) + '\n'), 0)
  taskPromise.then((v) => rec('resolved', v), (e) => rec('rejected', e))
  return orig.call(this, task, isCancelled, taskPromise)
}
