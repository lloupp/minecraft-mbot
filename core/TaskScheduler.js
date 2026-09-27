'use strict'

class TaskScheduler {
  constructor({ graph, workers = [], logger = console }) {
    this.graph = graph
    this.workers = workers
    this.logger = logger
    this.inFlight = new Map()
  }

  eligible(node) {
    return this.workers.filter(entry => {
      if (!entry?.id || !entry.layer) return false
      if (this.inFlight.has(entry.id)) return false
      if (node.role && entry.role && node.role !== entry.role) return false
      if (!entry.layer.availableActions().includes(node.action)) return false
      const state = entry.layer.state(node.objective)
      return !state.busy
    })
  }

  async tick() {
    const ready = this.graph.ready()
    const assignments = []
    const used = new Set()

    for (const node of ready) {
      const worker = this.eligible(node).find(entry => !used.has(entry.id))
      if (!worker) continue
      used.add(worker.id)
      this.graph.start(node.id, worker.id)
      const promise = this.run(worker, node)
      this.inFlight.set(worker.id, { taskId: node.id, promise })
      assignments.push({ taskId: node.id, worker: worker.id })
    }
    return assignments
  }

  async run(worker, node) {
    try {
      const result = await worker.layer.execute({
        worker: worker.id,
        task_id: node.id,
        objective: node.objective,
        action: node.action,
        args: node.args
      })
      if (result?.success) this.graph.complete(node.id, result)
      else this.graph.fail(node.id, result)
      this.logger.log?.(`[scheduler] ${worker.id} ${node.id}: ${result?.success ? 'completed' : 'failed'}`)
      return result
    } catch (error) {
      const result = { success: false, error: error.message }
      this.graph.fail(node.id, result)
      this.logger.log?.(`[scheduler] ${worker.id} ${node.id}: failed ${error.message}`)
      return result
    } finally {
      this.inFlight.delete(worker.id)
    }
  }

  async drain({ maxRounds = 100 } = {}) {
    let rounds = 0
    while (!this.graph.done() && rounds++ < maxRounds) {
      const assigned = await this.tick()
      if (!assigned.length) {
        if (this.inFlight.size) {
          await Promise.all([...this.inFlight.values()].map(value => value.promise))
          continue
        }
        break
      }
      await Promise.all(assigned.map(({ worker }) => this.inFlight.get(worker)?.promise).filter(Boolean))
    }
    return this.graph.snapshot()
  }
}

module.exports = { TaskScheduler }
