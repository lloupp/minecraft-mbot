// core/MissionRunner.js
// Executa um TaskGraph de missão nó a nó, persistindo cada transição.
// A ordem vem do TaskGraph; a execução vem dos executores; a conclusão só existe
// depois do verificador. Reinício não repete trabalho: o estado fica no MissionStore.

'use strict'

const { TaskGraph } = require('./TaskGraph')
const failure = require('../lib/failure')
const navTelemetry = require('../lib/nav-telemetry')

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function nowIso() {
  return new Date().toISOString()
}

class MissionRunner {
  constructor({
    store,
    bot = null,
    storage = null,
    capabilities = null,
    executors = {},
    verifiers = {},
    eventLog = null,
    logger = console,
    sleep = defaultSleep,
    maxAttempts = 3,
    retryBaseMs = 2000,
    retryMaxMs = 15000,
    preflight = null
  } = {}) {
    if (!store) throw new Error('MissionRunner exige MissionStore')
    this.store = store
    this.bot = bot
    this.storage = storage
    this.capabilities = capabilities
    this.executors = executors
    this.verifiers = verifiers
    this.eventLog = eventLog
    this.logger = logger
    this.sleep = sleep
    this.maxAttempts = maxAttempts
    this.retryBaseMs = retryBaseMs
    this.retryMaxMs = retryMaxMs
    this.preflight = preflight
    this.running = new Map()
    this.cancelled = new Set()
  }

  isRunning(id) {
    return this.running.has(String(id))
  }

  async cancel(id) {
    const mission = this.store.get(id)
    if (!mission) return false
    this.cancelled.add(String(id))
    if (this.running.has(String(id))) return true
    if (['pending', 'paused', 'interrupted'].includes(mission.status)) {
      this.store.setStatus(id, 'cancelled')
      await this.store.save()
      return true
    }
    return false
  }

  resume(id) {
    this.cancelled.delete(String(id))
  }

  _isCancelled(id, external) {
    return this.cancelled.has(String(id)) || Boolean(external?.())
  }

  _log(type, data) {
    this.eventLog?.log(type, data, this.bot?.username || null)
  }

  async run(id, { isCancelled = () => false, onProgress = () => {} } = {}) {
    const mission = this.store.get(id)
    if (!mission) throw new Error('missão não encontrada')
    const graph = new TaskGraph(mission.graph)
    const nodeAttempts = { ...(mission.nodeAttempts || {}) }
    const evidence = Array.isArray(mission.evidence) ? [...mission.evidence] : []
    this.running.set(String(id), true)
    this.cancelled.delete(String(id))

    const persist = async (patch = {}) => {
      this.store.update(id, { graph: graph.snapshot(), nodeAttempts, evidence, ...patch })
      await this.store.save()
    }

    this.store.setStatus(id, 'running')
    await persist({ status: 'running' })
    this._log('mission_started', { missionId: id, spec: mission.spec })

    let status = 'running'
    let lastFailure = null
    try {
      while (!graph.done()) {
        if (this._isCancelled(id, isCancelled)) {
          status = this.cancelled.has(String(id)) ? 'cancelled' : 'interrupted'
          break
        }
        const ready = graph.ready()
        if (!ready.length) {
          status = 'failed'
          lastFailure = { code: failure.CODES.UNKNOWN, detail: 'nenhum nó pronto', retryable: false, action: 'abort' }
          break
        }
        const node = ready[0]
        const result = await this._runNode(graph, node, {
          missionId: id,
          isCancelled,
          nodeAttempts,
          evidence,
          persist
        })
        onProgress({
          missionId: id,
          node: graph.get(node.id),
          graph: graph.snapshot(),
          status: result.cancelled ? 'cancelled' : result.ok ? 'completed' : 'failed',
          failure: result.failure || null
        })
        if (result.cancelled) {
          status = this.cancelled.has(String(id)) ? 'cancelled' : 'interrupted'
          break
        }
        if (!result.ok) {
          status = 'failed'
          lastFailure = result.failure || null
          break
        }
      }

      if (status === 'running') {
        const nodes = graph.snapshot()
        const bad = nodes.find((node) => ['failed', 'blocked', 'cancelled'].includes(node.status))
        status = bad ? (bad.status === 'cancelled' ? 'cancelled' : 'failed') : 'completed'
        if (bad?.result?.failure) lastFailure = bad.result.failure
      }
    } finally {
      this.running.delete(String(id))
    }

    await persist({
      status,
      lastError: lastFailure ? (lastFailure.detail || lastFailure.code) : null,
      recoveryRequired: status === 'interrupted'
    })
    this._log(
      status === 'completed' ? 'mission_completed' : status === 'cancelled' ? 'mission_cancelled' : 'mission_failed',
      { missionId: id, status, failure: lastFailure }
    )
    return { ok: status === 'completed', status, graph: graph.snapshot(), evidence, failure: lastFailure }
  }

  async _runNode(graph, rawNode, { missionId, isCancelled, nodeAttempts, evidence, persist }) {
    const node = graph.get(rawNode.id)
    let attempts = Number(nodeAttempts[node.id] || 0)
    const max = Math.max(1, Number(node.maxAttempts) || this.maxAttempts)
    const ctx = {
      bot: this.bot,
      storage: this.storage,
      missionId,
      node,
      isCancelled: () => this._isCancelled(missionId, isCancelled)
    }

    while (attempts < max) {
      if (this._isCancelled(missionId, isCancelled)) {
        graph.cancel(node.id)
        await persist()
        return { ok: false, cancelled: true }
      }

      graph.start(node.id, 'main')
      await persist()
      this._log('mission_node_started', { missionId, nodeId: node.id, action: node.action })

      let result = null
      try {
        if (this.preflight) {
          const check = await this.preflight(node, ctx)
          if (check && check.ok === false) {
            const blocker = check.blockers?.[0] || {}
            result = { ok: false, code: blocker.code, error: blocker.detail }
          }
        }
        if (!result) {
          const executor = this.executors[node.action]
          if (!executor) result = { ok: false, code: failure.CODES.UNKNOWN, error: `executor ausente: ${node.action}` }
          else result = await executor(node, ctx)
        }
      } catch (err) {
        result = { ok: false, error: err.message }
      }

      if (this._isCancelled(missionId, isCancelled)) {
        graph.cancel(node.id, { result })
        await persist()
        return { ok: false, cancelled: true }
      }

      if (!result || result.ok !== true) {
        const info = failure.classify({
          error: result?.error,
          code: result?.code,
          nav: navTelemetry.lastFailure(this.bot)
        })
        attempts += 1
        nodeAttempts[node.id] = attempts
        evidence.push({ nodeId: node.id, attempt: attempts, ok: false, failure: info, at: nowIso() })
        if (info.retryable && attempts < max) {
          // start() exige pending: devolve o nó para a fila antes da próxima tentativa.
          graph.setStatus(node.id, 'pending')
          await persist()
          await this.sleep(Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** (attempts - 1)))
          continue
        }
        graph.fail(node.id, { ...(result || {}), failure: info })
        await persist()
        this._log('mission_node_failed', { missionId, nodeId: node.id, failure: info })
        return { ok: false, failure: info }
      }

      const verifierName = node.verify || this.capabilities?.get?.(node.action)?.verifier || null
      if (verifierName && !this.verifiers[verifierName]) {
        const info = { code: failure.CODES.VERIFICATION_FAILED, detail: `verificador ausente: ${verifierName}`, retryable: false, action: 'abort' }
        graph.fail(node.id, { result, failure: info })
        await persist()
        this._log('mission_node_failed', { missionId, nodeId: node.id, failure: info })
        return { ok: false, failure: info }
      }

      let verification = { ok: true, detail: null }
      if (verifierName) {
        verification = await this.verifiers[verifierName](node, {
          ...ctx,
          ...(result.evidence || {})
        })
      }
      if (!verification.ok) {
        const info = {
          code: failure.CODES.VERIFICATION_FAILED,
          detail: verification.detail || 'pós-condição não confirmada',
          retryable: false,
          action: 'abort'
        }
        evidence.push({ nodeId: node.id, ok: false, failure: info, verification: verification.detail, at: nowIso() })
        graph.fail(node.id, { result, verification, failure: info })
        await persist()
        this._log('mission_node_failed', { missionId, nodeId: node.id, failure: info })
        return { ok: false, failure: info }
      }

      evidence.push({ nodeId: node.id, ok: true, evidence: result.evidence || {}, verification: verification.detail, at: nowIso() })
      graph.complete(node.id, { ...result, verification })
      await persist()
      this._log('mission_node_completed', { missionId, nodeId: node.id })
      return { ok: true }
    }

    const info = { code: failure.CODES.UNKNOWN, detail: 'tentativas esgotadas', retryable: false, action: 'abort' }
    graph.fail(node.id, { failure: info })
    await persist()
    this._log('mission_node_failed', { missionId, nodeId: node.id, failure: info })
    return { ok: false, failure: info }
  }
}

module.exports = { MissionRunner }
