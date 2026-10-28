const { randomUUID } = require('node:crypto')

class RequestQueue {
  constructor({ persist, candidates }) {
    this.persist = persist
    this.candidates = candidates
    this.requests = []
    this.reserved = new Set()
    this.dispatching = false
  }

  list() { return structuredClone(this.requests) }

  restore(requests) {
    this.requests = Array.isArray(requests) ? structuredClone(requests) : []
    for (const request of this.requests) {
      if (request.status === 'em_andamento') {
        request.status = 'interrompido'
        request.error = 'Reinício durante execução: confira inventário e estoque antes de repetir.'
      }
    }
  }

  async enqueue(role, task) {
    const entry = { id: randomUUID(), role, task: structuredClone(task), status: 'pendente', worker: null, createdAt: new Date().toISOString() }
    this.requests.push(entry)
    try { await this.persist(this.list()) } catch (err) {
      const index = this.requests.indexOf(entry)
      if (index >= 0) this.requests.splice(index, 1)
      throw err
    }
    return structuredClone(entry)
  }

  async cancel(id) {
    const matches = this.requests.filter(entry => entry.id === id || (id && entry.id.startsWith(id)))
    if (matches.length !== 1) throw new Error(matches.length ? 'identificador ambíguo' : 'pedido não encontrado')
    const request = matches[0]
    if (request.status !== 'pendente') throw new Error('somente pedidos pendentes podem ser cancelados com segurança')
    request.status = 'cancelado'
    await this.persist(this.list())
    return structuredClone(request)
  }

  async dispatch() {
    if (this.dispatching) return
    this.dispatching = true
    try {
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
        Promise.resolve().then(() => candidate.run(request.task)).then(result => {
          request.result = result || null
          if (result?.cancelled || result?.code === 'CANCELLED') request.status = 'interrompido'
          else if (!result || result.ok === false) request.status = 'falhou'
          else if (request.task.type === 'coletar_blocos') {
            request.status = 'revisao'
            request.error = 'Confira no estoque a entrega do recurso solicitado; o depósito pode incluir outros itens.'
          } else request.status = 'concluido'
        }, error => { request.status = 'falhou'; request.error = error.message }).finally(async () => {
          this.reserved.delete(candidate.name)
          try { await this.persist(this.list()) } catch (err) { console.error('[fila] falha ao salvar resultado:', err.message) }
        })
      }
    } finally { this.dispatching = false }
  }
}

module.exports = { RequestQueue }
