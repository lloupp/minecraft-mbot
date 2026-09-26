// core/scenarios.js
// Catálogo fixo de cenários de teste ao vivo usados pelo painel.
//
// Cada cenário tem:
// - preconditions(ctx): [{ name, ok, detail }] — alguma falsa: BLOCKED;
//   `skip: true` numa delas: SKIPPED (o cenário não se aplica a esta execução);
// - run(ctx, isCancelled): executa a ação e devolve a evidência observada;
// - required: campos que a evidência precisa ter;
// - validate(evidence): lista de motivos de reprovação (vazia = PASS).
//
// Nada aqui aceita comando, código ou argumento vindo do navegador: o painel só
// escolhe um id desta lista. `ctx` é montado no index.js com o bot real.

const LOG_NAMES = /_log$/
const PLAYER_INVENTORY_SLOTS = 46

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function pos(position) {
  return position ? { x: +position.x.toFixed(2), y: +position.y.toFixed(2), z: +position.z.toFixed(2) } : null
}

function countItems(bot, test) {
  return (bot.inventory?.items?.() || []).filter((item) => test(item.name)).reduce((sum, item) => sum + item.count, 0)
}

function connected(ctx) {
  const ok = Boolean(ctx.bot?.entity)
  return { name: 'bot conectado', ok, detail: ok ? ctx.bot.username : 'sem entidade no mundo' }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const SCENARIOS = [
  {
    id: 'conexao',
    title: 'Conexão e spawn',
    action: 'lê posição, dimensão, vida e fome do bot principal',
    timeoutMs: 5000,
    preconditions: (ctx) => [connected(ctx)],
    required: ['username', 'position', 'health', 'food', 'dimension'],
    async run(ctx) {
      const { bot } = ctx
      return {
        username: bot.username,
        position: pos(bot.entity.position),
        health: bot.health,
        food: bot.food,
        dimension: ctx.dimension?.() ?? null,
        gameMode: bot.game?.gameMode ?? null,
        version: bot.version
      }
    },
    validate(evidence) {
      const reasons = []
      const p = evidence.position
      if (!p || ![p.x, p.y, p.z].every(finite)) reasons.push('posição sem coordenadas numéricas')
      if (!finite(evidence.health) || evidence.health <= 0 || evidence.health > 20) reasons.push(`vida fora de 0..20: ${evidence.health}`)
      if (!finite(evidence.food) || evidence.food < 0 || evidence.food > 20) reasons.push(`fome fora de 0..20: ${evidence.food}`)
      if (!evidence.dimension) reasons.push('dimensão desconhecida')
      return reasons
    }
  },
  {
    id: 'inventario',
    title: 'Inventário sincronizado',
    action: 'confere os slots do inventário do jogador',
    timeoutMs: 5000,
    preconditions: (ctx) => [connected(ctx)],
    required: ['slots', 'items', 'totalItems'],
    async run(ctx) {
      const inventory = ctx.bot.inventory
      const items = inventory.items().map((item) => ({ slot: item.slot, name: item.name, count: item.count }))
      return {
        slots: inventory.slots.length,
        items,
        totalItems: items.reduce((sum, item) => sum + item.count, 0),
        occupiedSlots: inventory.slots.filter(Boolean).length
      }
    },
    validate(evidence) {
      const reasons = []
      if (evidence.slots !== PLAYER_INVENTORY_SLOTS) reasons.push(`esperava ${PLAYER_INVENTORY_SLOTS} slots, vieram ${evidence.slots}`)
      if (!Array.isArray(evidence.items)) return [...reasons, 'lista de itens ausente']
      const bad = evidence.items.filter((item) => !item.name || !Number.isInteger(item.count) || item.count <= 0)
      if (bad.length) reasons.push(`${bad.length} item(ns) sem nome ou quantidade`)
      const sum = evidence.items.reduce((total, item) => total + (item.count || 0), 0)
      if (sum !== evidence.totalItems) reasons.push(`soma ${sum} diferente do total ${evidence.totalItems}`)
      return reasons
    }
  },
  {
    id: 'coletar_madeira',
    title: 'Coletar 1 tronco',
    action: 'minera 1 tronco a até 32 blocos e recolhe o item',
    timeoutMs: 90000,
    preconditions(ctx) {
      const checks = [connected(ctx)]
      if (!checks[0].ok) return checks
      const nearby = ctx.countLogsNearby()
      checks.push({ name: 'tronco a até 32 blocos', ok: nearby > 0, detail: `${nearby} tronco(s)` })
      return checks
    },
    required: ['inventoryBefore', 'inventoryAfter', 'nearbyBefore', 'nearbyAfter'],
    async run(ctx, isCancelled) {
      const { bot } = ctx
      const inventoryBefore = countItems(bot, (name) => LOG_NAMES.test(name))
      const nearbyBefore = ctx.countLogsNearby()
      // A contagem final acontece dentro da tarefa: ao voltar a "seguir", a rotina
      // de equipamento pode transformar os troncos em tábuas antes da medição.
      const { mined, inventoryAfter, interrupted } = await ctx.mineLog(isCancelled, async () => {
        await sleep(500)
        return countItems(bot, (name) => LOG_NAMES.test(name))
      })
      return {
        mined,
        interrupted: Boolean(interrupted),
        inventoryBefore,
        inventoryAfter,
        nearbyBefore,
        nearbyAfter: ctx.countLogsNearby(),
        position: pos(bot.entity?.position)
      }
    },
    validate(evidence) {
      const reasons = []
      if (evidence.interrupted) reasons.push('tarefa interrompida (luta, fuga ou outro comando)')
      if (!(evidence.inventoryAfter - evidence.inventoryBefore >= 1)) {
        reasons.push(`troncos no inventário não aumentaram (${evidence.inventoryBefore} → ${evidence.inventoryAfter})`)
      }
      // nearbyBefore/After ficam só como registro: andando, o bot passa a ver outras árvores.
      if (evidence.mined !== undefined && !(evidence.mined >= 1)) reasons.push(`minerou ${evidence.mined} tronco(s)`)
      return reasons
    }
  },
  {
    id: 'smoke',
    title: 'Smoke da colônia',
    action: 'executa o !smoke (spawn, registry, base, estoque, workers, projeto)',
    timeoutMs: 60000,
    preconditions(ctx) {
      const checks = [connected(ctx)]
      const storage = Boolean(ctx.storage?.configured?.())
      checks.push({ name: 'estoque definido', ok: storage, detail: storage ? 'configurado' : 'use !base aqui e !estoque aqui' })
      return checks
    },
    required: ['ok', 'checks'],
    async run(ctx) {
      const result = await ctx.runSmoke()
      return { ok: result.ok, passed: result.passed, failed: result.failed, checks: result.checks }
    },
    validate(evidence) {
      const reasons = []
      if (!Array.isArray(evidence.checks) || !evidence.checks.length) return ['smoke sem verificações']
      for (const check of evidence.checks.filter((c) => c.ok === false)) reasons.push(`${check.name}: ${check.detail}`)
      if (evidence.ok !== true && !reasons.length) reasons.push('smoke não reportou sucesso')
      return reasons
    }
  },
  {
    id: 'worker',
    title: 'Criar worker',
    action: 'cria 1 ajudante e espera ele entrar no mundo',
    timeoutMs: 45000,
    preconditions(ctx) {
      const checks = [connected(ctx)]
      const capacity = ctx.botManager?.capacity?.() ?? 0
      checks.push({ name: 'vaga na colônia', ok: capacity > 0, detail: `${capacity} vaga(s)` })
      return checks
    },
    required: ['name', 'status', 'position'],
    async run(ctx, isCancelled) {
      const [worker] = await ctx.createWorker()
      const deadline = Date.now() + 30000
      while (Date.now() < deadline && !isCancelled()) {
        const state = worker.bot.colonyController?.state || worker.status
        if (worker.bot.entity && !['conectando'].includes(state)) break
        await sleep(500)
      }
      return {
        name: worker.name,
        role: worker.role,
        status: worker.bot.colonyController?.state || worker.status,
        position: pos(worker.bot.entity?.position)
      }
    },
    validate(evidence) {
      const reasons = []
      if (['conectando', 'erro', 'desconectado'].includes(evidence.status)) reasons.push(`worker ficou em "${evidence.status}"`)
      if (!evidence.position) reasons.push('worker sem posição no mundo')
      return reasons
    }
  },
  {
    id: 'visualizador',
    title: 'Visualizador 3D local',
    action: 'confere que o viewer responde e só escuta em 127.0.0.1',
    timeoutMs: 10000,
    preconditions(ctx) {
      const view = ctx.views?.()?.viewer
      if (!view?.port) return [{ name: 'MBOT_VIEWER_PORT definido', ok: false, skip: true, detail: 'visualizador desligado' }]
      return [{ name: 'visualizador iniciado', ok: view.status === 'ativo', detail: view.error || view.status }]
    },
    required: ['address', 'port', 'httpStatus'],
    async run(ctx) {
      const view = ctx.views().viewer
      const response = await fetch(`http://127.0.0.1:${view.port}/`)
      const body = await response.text()
      return { address: view.address, port: view.port, httpStatus: response.status, isViewerPage: /Prismarine Viewer/i.test(body) }
    },
    validate(evidence) {
      const reasons = []
      if (evidence.address !== '127.0.0.1') reasons.push(`escutando em ${evidence.address}, não em 127.0.0.1`)
      if (evidence.httpStatus !== 200) reasons.push(`HTTP ${evidence.httpStatus}`)
      if (!evidence.isViewerPage) reasons.push('resposta não é a página do viewer')
      return reasons
    }
  }
]

module.exports = { SCENARIOS, PLAYER_INVENTORY_SLOTS, LOG_NAMES }
