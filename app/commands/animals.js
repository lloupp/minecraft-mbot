// @ts-check
// app/commands/animals.js
// Animais: currais, metas de população, captura, reprodução e produtos.

const { Vec3 } = require('vec3')
const husbandry = require('../../lib/husbandry')
const animalProducts = require('../../lib/animalProducts')
const { groundedPenPlan, pointInsidePen, inspectAnimalPen } = require('../../core/AnimalPen')

function registerAnimalsCommands(commandRouter, ctx) {
  const { bot, botManager, colony, storage, production, homeProvider, persistSoon, companion } = ctx
  const { runTask, clearPatrolState } = companion

  commandRouter.register('animais', async (_context, args) => {
    const radius = Math.max(4, Math.min(64, Number.parseInt(args[0], 10) || 24))
    const nearby = husbandry.counts(bot, radius)
    const entries = Object.entries(nearby).sort((a, b) => b[1] - a[1])
    if (!entries.length) {
      bot.chat(`Não vejo animais suportados num raio de ${radius} blocos.`)
      return
    }
    bot.chat(`Animais (${radius} blocos): ${entries.map(([name, count]) => `${name}x${count}`).join(', ')}`)
  })

  commandRouter.register('curral', async (_context, args) => {
    const action = String(args[0] || 'vaca').toLowerCase()

    if (action === 'metas') {
      const targets = colony.animalTargetsSnapshot()
      const entries = Object.entries(targets)
      bot.chat(entries.length
        ? `Metas de animais: ${entries.map(([species, target]) => `${species}=${target}`).join(', ')}.`
        : 'Nenhuma meta persistente de animais configurada.')
      return
    }

    if (action === 'meta') {
      const species = husbandry.normalizeSpecies(args[1])
      const rawTarget = String(args[2] || '').toLowerCase()
      if (!species) {
        bot.chat('Uso: !curral meta <animal> <2-32|off>')
        return
      }
      if (['off', 'remover', 'apagar'].includes(rawTarget)) {
        const removed = colony.clearAnimalTarget(species)
        persistSoon()
        bot.chat(removed
          ? `Meta automática de ${species} removida.`
          : `Não havia meta automática para ${species}.`)
        return
      }

      const target = Number.parseInt(rawTarget, 10)
      if (!Number.isInteger(target) || target < 2 || target > 32) {
        bot.chat('Uso: !curral meta <animal> <2-32|off>')
        return
      }
      colony.setAnimalTarget(species, target)
      persistSoon()
      bot.chat(`Meta automática de ${species}: ${target}. Ela é mantida quando !colonia auto estiver ativo.`)
      return
    }

    const species = husbandry.normalizeSpecies(action)
    if (!species) {
      bot.chat('Uso: !curral <animal> | !curral metas | !curral meta <animal> <2-32|off>')
      return
    }
    const home = homeProvider()
    if (!home) {
      bot.chat('Base ainda não definida. Use !base aqui.')
      return
    }

    const plan = groundedPenPlan(bot, home, species)
    const status = inspectAnimalPen(bot, plan)
    const center = new Vec3(plan.center.x, plan.center.y, plan.center.z)
    const inside = husbandry.selectAnimals(bot, species, {
      center,
      range: plan.size + 2,
      filter: (entity) => pointInsidePen(entity.position, plan)
    }).length
    const target = colony.animalTargetsSnapshot()[species]

    bot.chat(
      `Curral ${species}: ${status.built ? 'pronto' : 'incompleto'} | cercas ${status.fencesPresent}/${status.fencesExpected} | portão ${status.gatePresent ? (status.gateOpen ? 'aberto' : 'fechado') : 'ausente'} | animais dentro ${inside}${target ? ` | meta ${target}` : ''}.`
    )
  })

  commandRouter.register(['capturar', 'recolheranimais'], async (_context, args) => {
    const species = husbandry.normalizeSpecies(args[0])
    const count = Math.max(1, Math.min(16, Number.parseInt(args[1], 10) || 1))
    if (!species) {
      bot.chat('Uso: !capturar <vaca|ovelha|porco|galinha|coelho|cabra|mooshroom|lhama> [qtd]')
      return
    }
    if (!homeProvider()) {
      bot.chat('Base ainda não definida. Use !base aqui.')
      return
    }

    try {
      const result = await colony.captureAnimals(species, count)
      bot.chat(`${result.name} vai levar até ${result.count} ${species} para o curral.`)
    } catch (err) {
      bot.chat(`Não consegui iniciar a captura: ${err.message}`)
    }
  })

  commandRouter.register(['reproduzir', 'criaranimais'], async (_context, args) => {
    const species = husbandry.normalizeSpecies(args[0])
    const pairs = Math.max(1, Math.min(16, Number.parseInt(args[1], 10) || 1))
    if (!species) {
      bot.chat('Uso: !reproduzir <vaca|ovelha|porco|galinha|coelho|cabra|mooshroom|lhama> [pares]')
      return
    }

    const farmers = botManager.byRole('fazendeiro')
    if (farmers.length) {
      try {
        const result = await colony.breedAnimals(species, pairs)
        bot.chat(`${result.name} vai tentar reproduzir ${pairs} par(es) de ${species}.`)
      } catch (err) {
        bot.chat(`Não consegui delegar a reprodução: ${err.message}`)
      }
      return
    }

    companion.autonomous = false
    clearPatrolState()
    persistSoon()
    bot.chat(`Vou tentar reproduzir ${pairs} par(es) de ${species}.`)
    runTask(`reproduzir ${species}`, async (isCancelled) => {
      const result = await husbandry.breed(bot, species, pairs, isCancelled, { storage })
      if (isCancelled()) return
      if (result.ok) {
        bot.chat(`Alimentei ${result.fed} ${species}; tentei ${result.pairsAttempted} par(es).`)
      } else if (result.reason === 'sem_alimento') {
        bot.chat(`Não tenho alimento adequado. Aceito: ${result.feed.join(', ')}.`)
      } else {
        bot.chat(`Não há animais suficientes: encontrei ${result.nearby} ${species}.`)
      }
    })
  })

  commandRouter.register(['manejo', 'populacao', 'população'], async (_context, args) => {
    const species = husbandry.normalizeSpecies(args[0])
    const target = Math.max(2, Math.min(32, Number.parseInt(args[1], 10) || 6))
    if (!species) {
      bot.chat('Uso: !manejo <vaca|ovelha|porco|galinha|coelho|cabra|mooshroom|lhama> [alvo]')
      return
    }

    const farmers = botManager.byRole('fazendeiro')
    if (farmers.length) {
      try {
        const result = await colony.manageAnimalPopulation(species, target)
        bot.chat(`${result.name} vai manejar ${species} com meta de ${result.target} animais.`)
      } catch (err) {
        bot.chat(`Não consegui delegar o manejo: ${err.message}`)
      }
      return
    }

    companion.autonomous = false
    clearPatrolState()
    persistSoon()
    runTask(`manejar população de ${species}`, async (isCancelled) => {
      const result = await husbandry.managePopulation(bot, species, target, isCancelled, { storage })
      if (isCancelled()) return
      if (result.action === 'nenhuma') {
        bot.chat(`População de ${species} já está na meta: ${result.current}/${result.target}.`)
      } else if (result.action === 'aguardar') {
        bot.chat(`Só encontrei ${result.current} ${species}; preciso de pelo menos dois para reproduzir.`)
      } else if (result.ok) {
        bot.chat(`Manejo de ${species}: atual ${result.current}, alvo ${result.target}, pares tentados ${result.pairsAttempted}.`)
      } else if (result.reason === 'sem_alimento') {
        bot.chat(`Manejo parado por falta de alimento: ${result.feed.join(', ')}.`)
      } else {
        bot.chat(`Manejo de ${species} incompleto; encontrei ${result.current} e a meta é ${result.target}.`)
      }
    })
  })

  commandRouter.register(['produto', 'produtoanimal'], async (_context, args) => {
    const product = animalProducts.normalizeProduct(args[0])
    const count = product === 'milk'
      ? Math.max(1, Math.min(16, Number.parseInt(args[1], 10) || 1))
      : product === 'eggs'
        ? 1
        : Math.max(1, Math.min(32, Number.parseInt(args[1], 10) || 1))
    if (!product) {
      bot.chat('Uso: !produto la [1-32] | !produto leite [1-16] | !produto ovos')
      return
    }

    const farmers = botManager.byRole('fazendeiro')
    if (!farmers.length) {
      bot.chat('Preciso de um fazendeiro na colônia para trabalhar dentro dos currais.')
      return
    }

    try {
      const result = await colony.collectAnimalProduct(product, count)
      bot.chat(`${result.name} recebeu a tarefa de coletar ${product}${product === 'eggs' ? ' disponível' : ` x${result.count}`}.`)
    } catch (err) {
      bot.chat(`Não consegui iniciar a produção animal: ${err.message}`)
    }
  })

  commandRouter.register(['tosquiar', 'tosquia'], async (_context, args) => {
    const count = Math.max(1, Math.min(32, Number.parseInt(args[0], 10) || 1))
    const farmers = botManager.byRole('fazendeiro')

    if (farmers.length) {
      try {
        const result = await colony.shearSheep(count)
        bot.chat(`${result.name} vai tentar tosquiar até ${result.count} ovelha(s).`)
      } catch (err) {
        bot.chat(`Não consegui delegar a tosquia: ${err.message}`)
      }
      return
    }

    companion.autonomous = false
    clearPatrolState()
    persistSoon()
    runTask('tosquiar ovelhas', async (isCancelled) => {
      const result = await husbandry.shearSheep(bot, count, isCancelled, {
        storage,
        production
      })
      if (isCancelled()) return
      if (result.ok) bot.chat(`Tentei tosquiar ${result.sheared} ovelha(s); recolhi os drops disponíveis.`)
      else bot.chat(result.reason === 'sem_tesoura'
        ? 'Não consegui uma tesoura.'
        : 'Não encontrei ovelhas disponíveis por perto.')
    })
  })
}

module.exports = { registerAnimalsCommands }
