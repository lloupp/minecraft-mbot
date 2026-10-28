'use strict'

// Ordem temporária que ganha prioridade sobre o planejamento normal da colônia.
// A unidade de progresso é uma coleta confirmada pelo executor (não uma estimativa).
const { normalizeWord, resolveBlockNames, isMineralGroup, mineralResourcesFor } = require('./resources')

const MAX_TARGET = 4096
const BATCH_SIZE = 12
const MAX_FAILURES = 3
const MAX_QUEUE = 100
const FOOD_NAMES = new Set(['comida', 'alimento', 'alimentos', 'food'])
const NON_PREEMPTIBLE = new Set([
  'fabricar', 'retirar_estoque', 'depositar', 'sincronizar_estoque',
  'construir_casa', 'construir_fazenda', 'construir_mina',
  'construir_planta', 'construir_curral', 'preparar_combate_deterministico'
])

class PriorityCollection {
  constructor({ controllers, logger = console, onFinished = () => {}, onChange = () => {} }) {
    this.controllers = controllers
    this.logger = logger
    this.onFinished = onFinished
    this.onChange = onChange
    this.pending = []
    this.paused = false
    this.current = null
    this.last = null
    this.sequence = 0
  }

  notifyChange() {
    try { this.onChange() } catch (err) { this.logger.log?.('[fila] persistência: ' + err.message) }
  }

  queueState() {
    return {
      paused: this.paused,
      active: this.current ? this.status() : null,
      pending: this.pending.map(({ id, resource, target }) => ({ id, resource, target })),
      last: this.last ? { status: this.last.status, resource: this.last.resource,
        target: this.last.target, gathered: this.last.gathered } : null
    }
  }

  exportState() {
    const current = this.current
    // Só salvar itens não confirmados; tarefas interrompidas não devem ser
    // cobradas duas vezes após o restart. Trabalho em voo requer reconciliação.
    const active = current ? [{ id: current.id, resource: current.resource,
      target: Math.max(1, current.target - current.gathered) }] : []
    return { paused: this.paused, nextId: this.sequence,
      tasks: [...active, ...this.pending].slice(0, MAX_QUEUE) }
  }

  restore(state) {
    this.paused = Boolean(state?.paused)
    this.pending = []
    this.sequence = Number.isSafeInteger(state?.nextId) && state.nextId >= 0 ? state.nextId : 0
    for (const row of Array.isArray(state?.tasks) ? state.tasks.slice(0, MAX_QUEUE) : []) {
      const resource = normalizeWord(row?.resource)
      const target = Number(row?.target)
      if (!resource || !Number.isSafeInteger(target) || target < 1 || target > MAX_TARGET) continue
      const id = Number.isSafeInteger(row.id) && row.id > 0 ? row.id : ++this.sequence
      this.sequence = Math.max(this.sequence, id)
      this.pending.push({ id, resource, target })
    }
    return this.queueState()
  }

  validate(resource, count) {
    const name = normalizeWord(resource)
    const target = Number(count)
    if (!name || name.length > 80) throw new Error('informe um recurso (ex.: ferro, diamante, minerais, madeira)')
    if (!Number.isSafeInteger(target) || target < 1 || target > MAX_TARGET) {
      throw new Error('quantidade deve ser um inteiro entre 1 e ' + MAX_TARGET)
    }
    return { resource: name, target }
  }

  enqueue(resource, count = 64, front = false) {
    if (this.pending.length >= MAX_QUEUE) throw new Error('fila cheia (máximo ' + MAX_QUEUE + ')')
    const entry = { id: ++this.sequence, ...this.validate(resource, count) }
    if (front) this.pending.unshift(entry)
    else this.pending.push(entry)
    this.notifyChange()
    this.tick()
    return entry
  }

  remove(id) {
    const index = this.pending.findIndex(entry => entry.id === Number(id))
    if (index < 0) throw new Error('tarefa não encontrada na fila: ' + id)
    const [removed] = this.pending.splice(index, 1)
    this.notifyChange()
    return removed
  }

  move(id, targetIndex = 0) {
    const index = this.pending.findIndex(entry => entry.id === Number(id))
    if (index < 0) throw new Error('tarefa não encontrada na fila: ' + id)
    const place = Number(targetIndex)
    if (!Number.isSafeInteger(place) || place < 0 || place >= this.pending.length) throw new Error('posição inválida')
    const [entry] = this.pending.splice(index, 1)
    this.pending.splice(place, 0, entry)
    this.notifyChange()
    return entry
  }

  pause() {
    this.paused = true
    if (this.current) {
      const order = this.current
      const remaining = Math.max(0, order.target - order.gathered)
      if (remaining > 0) this.pending.unshift({ id: order.id, resource: order.resource, target: remaining })
      this.stop('pausada')
    }
    this.notifyChange()
    return this.queueState()
  }

  resume() {
    this.paused = false
    this.notifyChange()
    this.tick()
    return this.queueState()
  }

  clearPending() {
    this.pending = []
    this.notifyChange()
    return this.queueState()
  }

  status() {
    const order = this.current || this.last
    if (!order) return { active: false, status: 'nenhuma' }
    return {
      active: this.current === order,
      status: order.status,
      resource: order.resource,
      target: order.target,
      gathered: order.gathered,
      remaining: Math.max(0, order.target - order.gathered),
      working: [...order.inFlight.keys()],
      waitingForDrain: [...order.draining],
      blocked: [...order.failed],
      minerals: Object.fromEntries(order.byMineral),
      startedAt: order.startedAt,
      finishedAt: order.finishedAt || null,
      errors: order.errors.slice(-4)
    }
  }

  start(resource, count = 64, fromQueue = null) {
    const { resource: name, target } = this.validate(resource, count)
    const workers = this.controllers()
    if (!workers.length) throw new Error('não há auxiliares na colônia')
    const isFood = FOOD_NAMES.has(name)
    const group = isMineralGroup(name)
    if (!isFood && !workers.some(({ controller }) => group
      ? mineralResourcesFor(controller.bot || {}).length > 0
      : resolveBlockNames(controller.bot || {}, name).length > 0)) {
      throw new Error('recurso desconhecido nos servidores dos auxiliares: ' + name)
    }

    if (this.current) this.stop('substituida')
    const order = {
      id: fromQueue?.id || ++this.sequence, resource: name, group, type: isFood ? 'fazenda' : 'coletar_blocos',
      target, gathered: 0, status: 'executando', nextMineralIndex: 0, byMineral: new Map(),
      excludedResources: new Map(),
      startedAt: new Date().toISOString(), finishedAt: null,
      inFlight: new Map(), draining: new Set(), failed: new Set(),
      failures: new Map(), retryAt: new Map(), errors: []
    }
    this.current = order

    // Interrompe apenas tarefas preemptíveis. Aguarda a promise física antiga
    // terminar antes de assumir movimento/inventário deste worker.
    for (const { worker, controller } of workers) {
      if (controller.state !== 'trabalhando' || !controller.currentTask ||
          NON_PREEMPTIBLE.has(controller.currentTask.type) ||
          controller.defending || controller.eating || controller.diggingOut ||
          controller.bot?.isSleeping || controller._toolReservation ||
          controller._toolDrain || controller._preparationDrain) continue
      const previous = controller.activeTaskPromise
      if (!previous) continue // execução sem drain rastreável: aguardar ocioso
      order.draining.add(worker.name)
      controller.cancel()
      Promise.resolve(previous).catch(() => {}).then(() => {
        order.draining.delete(worker.name)
        if (this.current === order) this.tick()
      })
    }
    this.notifyChange()
    this.tick()
    return this.status()
  }

  finish(order, status) {
    if (this.current !== order) return
    order.status = status
    order.finishedAt = new Date().toISOString()
    this.last = order
    this.current = null
    const snapshot = this.status()
    this.notifyChange()
    this.logger.log?.('[prioridade] ' + status + ': ' + order.resource +
      ' ' + order.gathered + '/' + order.target)
    try { this.onFinished(snapshot) } catch (err) {
      this.logger.log?.('[prioridade] notificação falhou: ' + err.message)
    }
    if (status === 'concluida' && !this.paused) this.tick()
  }

  stop(reason = 'cancelada') {
    const order = this.current
    if (!order) return this.status()
    // Uma tarefa manual ou de defesa que assumiu o worker não pode ser cancelada aqui.
    for (const { controller } of this.controllers()) {
      if (controller.currentTask?.priorityId === order.id) controller.cancel()
    }
    this.finish(order, reason)
    return this.status()
  }

  recordResult(order, workerName, resource, requested, result, error) {
    if (this.current !== order) return
    const collected = Math.max(0, Math.min(requested, Number.isFinite(Number(result?.gathered))
      ? Math.floor(Number(result.gathered)) : 0))
    order.gathered = Math.min(order.target, order.gathered + collected)
    if (error) order.errors.push(workerName + ': ' + error.message)
    else if (!collected && result?.code && result.code !== 'CANCELLED') {
      order.errors.push(workerName + ': ' + result.code)
    }
    if (collected > 0) {
      order.byMineral.set(resource, (order.byMineral.get(resource) || 0) + collected)
      order.failures.delete(workerName)
      order.retryAt.delete(workerName)
    } else if (result?.cancelled || result?.code === 'CANCELLED' || result?.code === 'PLAYER_LOOP_PREEMPTED') {
      // Defesa, morte e comandos do usuário sempre ganham do objetivo de coleta.
      order.retryAt.set(workerName, Date.now() + 5000)
    } else if (order.group) {
      // Mineral não encontrado: tentar OUTRO mineral antes de desistir do worker.
      const excluded = order.excludedResources.get(workerName) || new Set()
      excluded.add(resource)
      order.excludedResources.set(workerName, excluded)
      order.retryAt.set(workerName, Date.now() + 2500)
      const controller = this.controllers().find(({ worker }) => worker.name === workerName)?.controller
      if (controller && !mineralResourcesFor(controller.bot).some(name => !excluded.has(name))) {
        order.failed.add(workerName)
      }
    } else {
      const failures = (order.failures.get(workerName) || 0) + 1
      order.failures.set(workerName, failures)
      if (failures >= MAX_FAILURES) order.failed.add(workerName)
      else order.retryAt.set(workerName, Date.now() + failures * 5000)
    }
    if (order.errors.length > 20) order.errors.splice(0, order.errors.length - 20)
  }

  tick() {
    const order = this.current
    if (!order) {
      if (this.paused || !this.pending.length || !this.controllers().length) return false
      // Reinicialização: não rejeitar tarefas salvas enquanto os auxiliares
      // ainda estão conectando ou carregando a registry de blocos.
      if (!this.controllers().some(({ controller }) => controller.bot?.entity && controller.bot?.registry)) return true
      const next = this.pending[0]
      try {
        this.start(next.resource, next.target, next)
        this.pending.shift()
        this.notifyChange()
      } catch (err) {
        this.logger.log?.('[fila] não iniciei #' + next.id + ': ' + err.message)
        // Recurso indisponível: não travar todas as tarefas seguintes da fila.
        this.pending.shift()
        this.notifyChange()
        const snapshot = { active: false, status: 'bloqueada', resource: next.resource,
          target: next.target, gathered: 0, remaining: next.target, errors: [err.message] }
        try { this.onFinished(snapshot) } catch {}
      }
      return true
    }
    if (order.gathered >= order.target && order.inFlight.size === 0) {
      this.finish(order, 'concluida')
      return true
    }
    const workers = this.controllers()
    const available = workers.filter(({ worker, controller }) => {
      if (order.inFlight.has(worker.name) || order.draining.has(worker.name) ||
          order.failed.has(worker.name) || (order.retryAt.get(worker.name) || 0) > Date.now()) return false
      if (!controller.bot?.entity || !controller.isIdle?.() || controller.currentTask ||
          controller.defending || controller.eating || controller.diggingOut ||
          controller.bot.isSleeping || controller._preparationDrain || controller._toolDrain ||
          controller.activeTaskPromise) return false
      if (order.group) {
        const excluded = order.excludedResources.get(worker.name) || new Set()
        return mineralResourcesFor(controller.bot).some(name => !excluded.has(name))
      }
      return order.type === 'fazenda' || resolveBlockNames(controller.bot, order.resource).length > 0
    })
    let unreserved = order.target - order.gathered -
      [...order.inFlight.values()].reduce((sum, amount) => sum + amount, 0)
    for (let i = 0; i < available.length && unreserved > 0; i++) {
      const { worker, controller } = available[i]
      const alternatives = order.group
        ? mineralResourcesFor(controller.bot).filter(name => !(order.excludedResources.get(worker.name)?.has(name)))
        : [order.resource]
      if (!alternatives.length) { order.failed.add(worker.name); continue }
      const resource = alternatives[order.nextMineralIndex++ % alternatives.length]
      const amount = Math.min(BATCH_SIZE, Math.ceil(unreserved / (available.length - i)))
      unreserved -= amount
      const task = {
        type: order.type, resource, count: amount,
        reason: 'prioridade_usuario', priorityId: order.id
      }
      order.inFlight.set(worker.name, amount)
      const ownerVersion = controller.taskVersion
      const canStart = () => this.current === order &&
        controller.isIdle() && !controller.currentTask && controller.taskVersion === ownerVersion
      Promise.resolve().then(() => controller.run(task, { canStart }))
        .then((result) => this.recordResult(order, worker.name, resource, amount, result, null))
        .catch((error) => this.recordResult(order, worker.name, resource, amount, null, error))
        .finally(() => {
          order.inFlight.delete(worker.name)
          if (this.current === order) this.tick()
        })
    }

    // Não aguardar indefinidamente se todos os trabalhadores disponíveis
    // comprovaram repetidas falhas sem obter nenhum bloco.
    if (order.inFlight.size === 0 && workers.length &&
        workers.every(({ worker }) => order.failed.has(worker.name))) {
      this.finish(order, 'bloqueada')
    }
    return true
  }
}

module.exports = { PriorityCollection, MAX_TARGET }
