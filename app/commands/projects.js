// @ts-check
// app/commands/projects.js
// Projetos da colônia (casa, fazenda, mina, vila, planta) e construção.

const blueprint = require('../../lib/blueprint')
const { buildBlueprint, describeReport } = require('../../lib/blueprintBuilder')
const husbandry = require('../../lib/husbandry')
const { parseCount } = require('./parse')

function registerProjectsCommands(commandRouter, ctx) {
  const { bot, colony, storage, projectManager, homeProvider, persistSoon, ensureProjectWorkers, companion } = ctx
  const { runTask, ownerEntity } = companion

  function projectStatusLines() {
    const report = colony.demandReport()
    const status = projectManager.status(report)
    if (!status) return ['Nenhum projeto ativo. Tipos: casa, fazenda, mina, vila, planta <nome>.']

    const actionDone = status.actions.filter((a) => a.status === 'concluido').length
    const actionTotal = status.actions.length
    if (status.status !== 'ativo') {
      return [`Projeto ${status.type}: ${status.status} | obras ${actionDone}/${actionTotal || 0}`]
    }
    if (status.type === 'planta') {
      const lines = [`Projeto ${status.label}: ${status.status} | obras ${actionDone}/${actionTotal || 0}`]
      const lacking = status.missingMaterials || {}
      lines.push(Object.keys(lacking).length
        ? `Falta no estoque: ${blueprint.formatMaterials(lacking)}`
        : 'Material das obras pendentes disponível no estoque.')
      const errors = status.actions.filter((a) => a.lastError).map((a) => `${a.id}: ${a.lastError}`)
      if (errors.length) lines.push(errors.slice(0, 2).join(' | '))
      return lines
    }
    const deficits = status.deficits || {}
    const missing = Object.entries(deficits)
      .filter(([, value]) => Number(value || 0) > 0)
      .slice(0, 5)
      .map(([key, value]) => `${key}:${value}`)
      .join(', ')

    return [
      `Projeto ${status.type}: ${status.status} | obras ${actionDone}/${actionTotal || 0}`,
      missing ? `Faltas: ${missing}` : 'Recursos-alvo atingidos.'
    ]
  }

  // Ponto de origem da planta: onde o dono está (ou o próprio bot, com "aqui").
  function blueprintOrigin(useBot) {
    const entity = useBot ? bot.entity : ownerEntity()
    if (!entity) return null
    const p = entity.position
    return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }
  }

  // Colônia: divide a planta em fatias entre construtores; cada fatia só começa
  // quando o estoque central tem o material dela, e o que falta entra na demanda.
  async function startBlueprintProject(name, buildersArg) {
    try {
      if (!name) throw new Error(`diga a planta: ${blueprint.listBlueprints().map((p) => p.name).join(', ') || 'nenhuma em plantas/'}`)
      if (!homeProvider()) throw new Error('defina a base primeiro com !base aqui')
      if (!storage.configured()) throw new Error('defina o estoque primeiro com !estoque aqui')
      if (projectManager.isActive()) throw new Error(`já existe projeto ativo: ${projectManager.active.type}`)
      const origin = blueprintOrigin(false)
      if (!origin) throw new Error('não estou te vendo; fique onde a planta deve começar')

      const plan = await blueprint.loadBlueprint(name, { version: bot.version })
      const builders = Math.max(1, Math.min(4, Number.parseInt(buildersArg, 10) || 2))
      const regions = blueprint.splitRegions(plan, builders).map((region) => ({
        region,
        materials: blueprint.regionMaterials(plan, region)
      }))
      const roles = { construtor: regions.length, minerador: 1, lenhador: 1, artesao: 1 }
      const created = await ensureProjectWorkers('planta', roles)
      projectManager.startBlueprint({ name: plan.name, origin, size: plan.size, regions, builders: regions.length })
      colony.setAuto(true)
      persistSoon()

      bot.chat(`Projeto planta ${plan.name} (${plan.size.x}x${plan.size.y}x${plan.size.z}) iniciado em ${origin.x} ${origin.y} ${origin.z}, ${regions.length} fatia(s).`)
      if (created.length) bot.chat(`Bots criados para o projeto: ${created.join(', ')}`)
      for (const line of projectStatusLines()) bot.chat(line)
    } catch (err) {
      bot.chat(`Não consegui iniciar a planta: ${err.message}`)
    }
  }

  // Bot principal: constrói sozinho com o que tem no inventário.
  async function buildBlueprintSolo(name, useBot) {
    if (!name) {
      bot.chat('Uso: !construir planta <nome> [aqui]. Veja !plantas')
      return
    }
    let plan
    try {
      plan = await blueprint.loadBlueprint(name, { version: bot.version })
    } catch (err) {
      bot.chat(`${err.message}. Veja !plantas`)
      return
    }
    const origin = blueprintOrigin(useBot)
    if (!origin) {
      bot.chat('Não estou te vendo. Use !construir planta <nome> aqui para construir onde eu estou.')
      return
    }
    const steps = blueprint.buildOrder(plan)
    const { materials, ignored } = blueprint.materialList(plan.blocks)
    const missing = blueprint.missingMaterials(materials, blueprint.inventoryCounts(bot.inventory.items()))
    if (Object.keys(missing).length) {
      bot.chat(`Para a planta ${plan.name} faltam: ${blueprint.formatMaterials(missing, 10)}`)
      return
    }
    if (Object.keys(ignored).length) bot.chat(`Vou pular o que não se coloca com a mão: ${blueprint.formatMaterials(ignored)}`)
    bot.chat(`Construindo ${plan.name} (${plan.size.x}x${plan.size.y}x${plan.size.z}, ${steps.length} blocos) em ${origin.x} ${origin.y} ${origin.z}. Saia da área!`)
    runTask('construir planta', async (isCancelled) => {
      const report = await buildBlueprint(bot, steps, origin, {
        isCancelled,
        clear: plan.air,
        log: (msg) => console.log(`[planta] ${msg}`)
      })
      if (isCancelled()) return
      console.log(`[planta] ${plan.name}:`, report)
      bot.chat(`Planta ${plan.name}: ${describeReport(report)}.`)
      if (report.obstructed.length) {
        const first = report.obstructed.slice(0, 3).map((o) => `${o.name} em ${o.x} ${o.y} ${o.z}`).join('; ')
        bot.chat(`Não quebrei blocos que não são terreno natural: ${first}`)
      }
    }, { resume: 'ficar' })
  }

  commandRouter.register('plantas', async (_context, args) => {
    const name = args[0]
    if (!name) {
      const list = blueprint.listBlueprints()
      bot.chat(list.length
        ? `Plantas: ${list.map((p) => p.name).join(', ')}. Detalhes: !plantas <nome>`
        : 'Nenhuma planta em plantas/ (.schem, .litematic, .schematic, .nbt).')
      return
    }
    try {
      const summary = blueprint.summarize(await blueprint.loadBlueprint(name, { version: bot.version }))
      bot.chat(`${summary.name}: ${summary.size.x}x${summary.size.y}x${summary.size.z}, ${summary.blocks} blocos.`)
      bot.chat(`Materiais: ${blueprint.formatMaterials(summary.materials, 12)}`)
    } catch (err) {
      bot.chat(`Não consegui ler a planta: ${err.message}`)
    }
  })

  commandRouter.register(['projeto', 'projetos'], async (_context, args) => {
    let action = String(args[0] || 'status').toLowerCase()

    if (action === 'tipos' || action === 'listar' || action === 'lista') {
      bot.chat(`Projetos: ${projectManager.types().join(', ')}.`)
      return
    }

    if (action === 'status') {
      for (const line of projectStatusLines()) bot.chat(line)
      return
    }

    if (action === 'cancelar' || action === 'parar') {
      for (const { controller } of colony.controllers()) {
        if (controller.currentTask?.projectType) controller.cancel()
      }
      const cancelled = projectManager.cancel()
      persistSoon()
      if (!cancelled) {
        bot.chat('Nenhum projeto para cancelar.')
        return
      }
      bot.chat(`Projeto ${cancelled.type} cancelado. O modo automático continua disponível para a colônia.`)
      return
    }

    // "!projeto iniciar <tipo>" é o mesmo que "!projeto <tipo>".
    const rest = action === 'iniciar' ? args.slice(2) : args.slice(1)
    if (action === 'iniciar') action = String(args[1] || '').toLowerCase()

    if (action === 'planta') {
      await startBlueprintProject(rest[0], rest[1])
      return
    }

    const definition = projectManager.definition(action)
    if (!definition) {
      bot.chat('Uso: !projeto <casa|fazenda|mina|vila> | !projeto planta <nome> [construtores] | !projeto status | !projeto cancelar')
      return
    }

    try {
      if (!homeProvider()) throw new Error('defina a base primeiro com !base aqui')
      if (!storage.configured()) throw new Error('defina o estoque primeiro com !estoque aqui')
      if (projectManager.isActive()) throw new Error(`já existe projeto ativo: ${projectManager.active.type}`)

      const created = await ensureProjectWorkers(action)
      projectManager.start(action)
      colony.setAuto(true)
      persistSoon()

      bot.chat(`Projeto ${action} iniciado. Orquestração automática ativada.`)
      if (created.length) bot.chat(`Bots criados para o projeto: ${created.join(', ')}`)
      for (const line of projectStatusLines()) bot.chat(line)
    } catch (err) {
      bot.chat(`Não consegui iniciar o projeto: ${err.message}`)
    }
  })

  commandRouter.register('construir', async (_context, args) => {
    const what = String(args[0] || '').toLowerCase()
    if (what === 'planta') {
      await buildBlueprintSolo(args[1], String(args[2] || '').toLowerCase() === 'aqui')
      return
    }
    try {
      if (['casa', 'abrigo'].includes(what)) {
        const name = await colony.buildHouse()
        bot.chat(`${name} recebeu a ordem de construir um abrigo 3x3.`)
        return
      }
      if (what === 'fazenda') {
        const name = await colony.buildFarm()
        bot.chat(`${name} recebeu a ordem de preparar uma fazenda física 5x5.`)
        return
      }
      if (what === 'mina') {
        const length = parseCount(args[1], 12)
        const name = await colony.buildMine(length)
        bot.chat(`${name} recebeu a ordem de abrir uma mina de ${length} blocos.`)
        return
      }
      if (what === 'curral') {
        const species = husbandry.normalizeSpecies(args[1] || 'vaca')
        if (!species) {
          bot.chat('Uso: !construir curral <vaca|ovelha|porco|galinha|coelho|cabra|mooshroom|lhama>')
          return
        }
        const result = await colony.buildAnimalPen(species)
        bot.chat(`${result.name} recebeu a ordem de construir um curral 7x7 para ${species}.`)
        return
      }
      bot.chat('Uso: !construir casa | !construir fazenda | !construir mina [comprimento] | !construir curral [animal] | !construir planta <nome> [aqui]')
    } catch (err) {
      bot.chat(`Não consegui iniciar a construção: ${err.message}`)
    }
  })
}

module.exports = { registerProjectsCommands }
