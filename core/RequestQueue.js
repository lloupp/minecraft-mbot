const { randomUUID } = require('node:crypto')
const TERMINAL = new Set(['concluido', 'cancelado', 'falhou', 'interrompido', 'revisao'])

class RequestQueue {
  constructor({ persist, candidates }) {
    this.persist = persist
    this.candidates = candidates
    this.requests = []
    this.reserved = new Set()
    this.dispatching = false
    this._writes = Promise.resolve()
    this.persistenceError = null
  }

  list() { return structuredClone(this.requests) }

  _exclusive(fn) {
    const run = this._writes.then(fn, fn)
    this._writes = run.catch(() => {})
    return run
  }

  restore(requests) {
    if (requests != null && !Array.isArray(requests)) throw new Error('fila salva inválida: esperado array')
    this.requests = structuredClone(requests || [])
    for (const request of this.requests) {
      if (!request || typeof request.id !== 'string' || typeof request.role !== 'string' || !request.task?.type ||
          !['pendente', 'em_andamento', ...TERMINAL].includes(request.status)) throw new Error('pedido salvo inválido')
      if (request.status === 'em_andamento') {
        request.status = 'interrompido'
        request.error = 'Reinício durante execução: confira inventário e estoque antes de repetir.'
      }
    }
  }

  enqueue(role, task) {
    return this._exclusive(async () => {
      if (typeof role !== 'string' || !role || !task || typeof task.type !== 'string') throw new Error('pedido inválido')
      if (task.count != null && (!Number.isInteger(task.count) || task.count < 1 || task.count > 4096)) throw new Error('quantidade deve ser de 1 a 4096')
      if (this.requests.filter(r => !TERMINAL.has(r.status)).length >= 100) throw new Error('fila cheia (100 pedidos ativos)')
      const entry = { id: randomUUID(), role, task: structuredClone(task), status: 'pendente', worker: null, createdAt: new Date().toISOString() }
      this.requests.push(entry)
      try { await this.persist(this.list()) } catch (err) { this.requests.splice(this.requests.indexOf(entry), 1); throw err }
      return structuredClone(entry)
    })
  }

  cancel(id) {
    return this._exclusive(async () => {
      const matches = this.requests.filter(entry => entry.id === id || (id && entry.id.startsWith(id)))
      if (matches.length !== 1) throw new Error(matches.length ? 'identificador ambíguo' : 'pedido não encontrado')
      const request = matches[0]
      if (request.status !== 'pendente') throw new Error('somente pedidos pendentes podem ser cancelados com segurança')
      request.status = 'cancelado'
      try { await this.persist(this.list()) } catch (err) { request.status = 'pendente'; throw err }
      return structuredClone(request)
    })
  }

  async _finish(request, result, error) {
    await this._exclusive(async () => {
      request.result = result || null
      request.finishedAt = new Date().toISOString()
      if (error) { request.status = 'falhou'; request.error = error.message }
      else if (result?.cancelled || ['CANCELLED', 'PLAYER_LOOP_PREEMPTED'].includes(result?.code)) request.status = 'interrompido'
      else if (!result || result.ok === false) { request.status = 'falhou'; request.error = result?.code || 'execução não confirmou sucesso' }
      else if (request.task.type === 'coletar_blocos') {
        request.status = 'revisao'
        request.error = 'Confira no estoque a entrega do recurso solicitado; o depósito pode incluir outros itens.'
      } else request.status = 'concluido'
      try {
        await this.persist(this.list())
        this.persistenceError = null
      } catch (err) {
        // Keep observed result in memory. On restart, the persisted in-flight
        // record becomes interrupted, never a blind repeat of physical work.
        this.persistenceError = err.message
        console.error('[fila] falha ao salvar resultado:', err.message)
      }
    })
  }

  async dispatch() {
    if (this.dispatching) return
    this.dispatching = true
    try {
      await this._exclusive(async () => {
        if (this.persistenceError) { await this.persist(this.list()); this.persistenceError = null }
        for (const request of this.requests) {
          if (request.status !== 'pendente') continue
          const candidate = this.candidates().find(worker => worker.role === request.role && worker.idle && !this.reserved.has(worker.name))
          if (!candidate) continue
          this.reserved.add(candidate.name)
          request.status = 'em_andamento'
          request.worker = candidate.name
          try { await this.persist(this.list()) } catch (err) {
            request.status = 'pendente'; request.worker = null; this.reserved.delete(candidate.name); throw err
          }
          Promise.resolve().then(() => candidate.run(request.task))
            .then(result => this._finish(request, result), error => this._finish(request, null, error))
            .catch(error => { this.persistenceError = error.message })
            .finally(() => this.reserved.delete(candidate.name))
        }
      })
    } finally { this.dispatching = false }
  }
}
module.exports = { RequestQueue }
