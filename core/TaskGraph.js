'use strict'

const VALID_STATUS = new Set(['pending', 'running', 'completed', 'failed', 'cancelled', 'blocked'])

class TaskGraph {
  constructor(nodes = []) {
    this.nodes = new Map()
    for (const node of nodes) this.add(node)
    this.assertAcyclic()
  }

  add(node) {
    if (!node || typeof node !== 'object') throw new Error('task node inválido')
    const id = String(node.id || '')
    if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(id)) throw new Error('task id inválido')
    if (this.nodes.has(id)) throw new Error(`task duplicada: ${id}`)
    const deps = [...new Set((node.dependsOn || []).map(String))]
    this.nodes.set(id, {
      id,
      action: node.action,
      args: { ...(node.args || {}) },
      objective: node.objective || null,
      role: node.role || null,
      dependsOn: deps,
      status: node.status || 'pending',
      assignedWorker: node.assignedWorker || null,
      result: node.result || null
    })
    return this.get(id)
  }

  get(id) {
    const node = this.nodes.get(String(id))
    return node ? JSON.parse(JSON.stringify(node)) : null
  }

  assertAcyclic() {
    const seen = new Set()
    const active = new Set()
    const visit = (id) => {
      if (active.has(id)) throw new Error(`ciclo de dependência em ${id}`)
      if (seen.has(id)) return
      const node = this.nodes.get(id)
      if (!node) throw new Error(`dependência inexistente: ${id}`)
      active.add(id)
      for (const dep of node.dependsOn) {
        if (!this.nodes.has(dep)) throw new Error(`dependência inexistente: ${dep}`)
        visit(dep)
      }
      active.delete(id)
      seen.add(id)
    }
    for (const id of this.nodes.keys()) visit(id)
    return true
  }

  ready() {
    this.refreshBlocked()
    return [...this.nodes.values()]
      .filter(node => node.status === 'pending' && node.dependsOn.every(dep => this.nodes.get(dep)?.status === 'completed'))
      .map(node => this.get(node.id))
  }

  setStatus(id, status, extra = {}) {
    if (!VALID_STATUS.has(status)) throw new Error(`status inválido: ${status}`)
    const node = this.nodes.get(String(id))
    if (!node) throw new Error(`task não encontrada: ${id}`)
    node.status = status
    Object.assign(node, extra)
    this.refreshBlocked()
    return this.get(id)
  }

  start(id, worker) {
    const node = this.nodes.get(String(id))
    if (!node || node.status !== 'pending') throw new Error('task não está pendente')
    if (!node.dependsOn.every(dep => this.nodes.get(dep)?.status === 'completed')) throw new Error('dependências incompletas')
    return this.setStatus(id, 'running', { assignedWorker: worker })
  }

  complete(id, result) {
    return this.setStatus(id, 'completed', { result })
  }

  fail(id, result) {
    return this.setStatus(id, 'failed', { result })
  }

  cancel(id, result = null) {
    return this.setStatus(id, 'cancelled', { result })
  }

  refreshBlocked() {
    for (const node of this.nodes.values()) {
      if (node.status !== 'pending') continue
      if (node.dependsOn.some(dep => ['failed', 'cancelled', 'blocked'].includes(this.nodes.get(dep)?.status))) {
        node.status = 'blocked'
      }
    }
  }

  done() {
    return [...this.nodes.values()].every(node => ['completed', 'failed', 'cancelled', 'blocked'].includes(node.status))
  }

  snapshot() {
    return [...this.nodes.values()].map(node => this.get(node.id))
  }
}

module.exports = { TaskGraph, VALID_STATUS }
