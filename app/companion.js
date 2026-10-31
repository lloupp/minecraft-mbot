// @ts-check
// app/companion.js
// O bot principal como companheiro do dono: segue, foge, luta, come, passa a
// noite, executa tarefas longas (uma por vez, canceláveis) e o modo autônomo.
// O estado é privado; quem está fora (comandos, painel) usa os acessores.

const { Movements, goals } = require('mineflayer-pathfinder')
const food = require('../lib/food')
const craft = require('../lib/craft')
const gather = require('../lib/gather')
const combat = require('../lib/combat')
const equipment = require('../lib/equipment')
const night = require('../lib/night')
const { Autonomy } = require('../lib/autonomy')
const { inferido } = require('../core/Memory')

const FOLLOW_DISTANCE = 2   // blocos de distância ao seguir o dono
const FLEE_DISTANCE = 16    // distância que tenta manter do agressor
const FLEE_MS = 4000        // tempo fugindo depois de tomar dano
const DEFEND_RANGE = 5      // hostil mais perto que isso: o bot reage (luta ou foge)
const CREEPER_RANGE = 6     // creeper mais perto que isso: foge antes que exploda
const CHAIN_RANGE = 8       // depois de matar, emenda luta com hostil até essa distância
const CHAIN_FIGHTS = 6      // máximo de lutas emendadas numa mesma tarefa
const HUNGRY = 14           // abaixo disso come (ou vai buscar comida)
const FOOD_RETRY_MS = 30000 // espera entre buscas de comida que não deram certo
const OWNER_NEAR = 32
const GEAR_CHECK_MS = 15000
const NIGHT_RETRY_MS = 60000
const EXPLORE_DISTANCE = 50
const EXPLORE_EVERY_MS = 20000

function createCompanion({ bot, memory, botManager, places, owner: OWNER = null, initialAutonomous = false, persistSoon = () => {} }) {
  const { assertWaypointReachable, placeLabel } = places

  let mode = 'seguir'       // 'seguir' | 'ficar' | 'tarefa'
  let taskName = null       // descrição da tarefa em andamento
  let eating = false
  let warnedNoFood = false  // já avisou no chat que não acha comida
  let lastFoodSearch = Date.now() - FOOD_RETRY_MS + 10000 // 1ª busca após 10s (entidades carregando)
  let fleeingUntil = 0
  let lastHealth = null
  let lastAttacker = null
  let taskId = 0            // incrementado para cancelar a tarefa em andamento
  let followMoves, workMoves
  let resolvedOwner = OWNER
  let fightTarget = null     // mob com quem está lutando
  let fightResume = 'seguir' // modo para voltar depois da luta
  let autonomous = initialAutonomous
  let sheltered = false
  let lastNightTry = 0
  let lastGearCheck = 0
  let checkingGear = false
  let patrolActive = false
  let patrolRoute = []
  let patrolVersion = 0
  const autonomy = new Autonomy(bot)

  function ownerName() {
    if (resolvedOwner) return resolvedOwner
    const candidate = Object.keys(bot.players).find((name) =>
      name !== bot.username && !botManager.get(name)
    )
    if (candidate) resolvedOwner = candidate
    return resolvedOwner
  }

  function ownerEntity() {
    return bot.players[ownerName()]?.entity
  }

  async function goToPoint(position, isCancelled, radius = 2) {
    const x = Math.floor(Number(position.x))
    const y = Math.floor(Number(position.y))
    const z = Math.floor(Number(position.z))
    if (![x, y, z].every(Number.isFinite)) throw new Error('posição inválida')

    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        bot.pathfinder.setGoal(null)
        reject(new Error('caminho demorou demais'))
      }, 60000)
    })

    try {
      await Promise.race([
        bot.pathfinder.goto(new goals.GoalNear(x, y, z, radius)),
        timeout
      ])
      return !isCancelled()
    } finally {
      clearTimeout(timer)
    }
  }

  function nearestHostile(maxDist) {
    return bot.nearestEntity((e) => e.type === 'hostile' && e.position.distanceTo(bot.entity.position) <= maxDist)
  }

  function follow() {
    const owner = ownerEntity()
    if (!owner) return
    bot.pathfinder.setMovements(followMoves)
    const distance = memory.preferenciaNumero('seguir.distancia', FOLLOW_DISTANCE, 1, 16)
    bot.pathfinder.setGoal(new goals.GoalFollow(owner, distance), true)
  }

  function cancelTask() {
    taskId++
    taskName = null
    if (bot.targetDigBlock) bot.stopDigging()
    bot.pathfinder.setGoal(null)
  }

  // Foge do agressor (ou do hostil mais próximo); sem ameaça visível, corre para o dono.
  function flee(attacker) {
    if (mode === 'tarefa') {
      bot.chat(taskName === 'lutar' ? 'Recuando!' : `Estou apanhando! Parei de ${taskName}.`)
      cancelTask()
      mode = 'seguir'
    }
    fleeingUntil = Date.now() + FLEE_MS
    const threat = attacker && attacker !== bot.entity && attacker.isValid !== false ? attacker : nearestHostile(FLEE_DISTANCE)
    bot.pathfinder.setMovements(followMoves)
    if (threat) {
      console.log(`Fugindo de ${threat.username || threat.name} (HP ${Math.round(bot.health)})`)
      bot.pathfinder.setGoal(new goals.GoalInvert(new goals.GoalFollow(threat, FLEE_DISTANCE)), true)
    } else {
      follow()
    }
  }

  // Ações do próprio orquestrador que andam (ler o baú, smoke test). No modo
  // seguir, o laço principal troca o objetivo do pathfinder a cada 500 ms e o
  // goto falharia com "The goal was changed before it could be completed!".
  // O contador cobre chamadas sobrepostas: só volta a seguir quando a última acaba.
  let pausedFollowing = 0
  let pauseName = null
  async function withoutFollowing(name, fn) {
    if (mode !== 'seguir' && !pausedFollowing) return fn()
    if (!pausedFollowing++) {
      mode = 'tarefa'
      taskName = pauseName = name
    }
    try {
      return await fn()
    } finally {
      // Outra tarefa pode ter começado no meio (runTask troca taskName): não a sobrescreve.
      if (!--pausedFollowing && mode === 'tarefa' && taskName === pauseName) {
        mode = 'seguir'
        taskName = null
      }
    }
  }

  // Executa uma tarefa longa. `fn` recebe isCancelled() e deve parar quando for true
  // (fuga, !cancelar, outra tarefa). No fim, volta a seguir o dono (ou a `resume`).
  async function runTask(name, fn, { resume = 'seguir' } = {}) {
    cancelTask()
    const myTask = taskId
    const isCancelled = () => myTask !== taskId
    mode = 'tarefa'
    taskName = name
    bot.pathfinder.setMovements(workMoves)
    try {
      await fn(isCancelled)
    } catch (err) {
      if (!isCancelled()) bot.chat(`Não consegui ${name}: ${err.message}`)
    }
    if (isCancelled()) return
    taskName = null
    mode = resume
    if (resume === 'seguir' && !autonomous) follow()
    else bot.pathfinder.setGoal(null)
  }

  function autonomyStep() {
    const goal = autonomy.next()
    if (!goal) return false
    console.log(`[autônomo] meta: ${goal.name}`)
    runTask(goal.name, async (isCancelled) => {
      try {
        const result = await goal.run(bot, isCancelled)
        if (isCancelled()) return
        autonomy.succeeded(goal)
        if (result) console.log(`[autônomo] ${goal.name}: ${result}`)
      } catch (err) {
        if (isCancelled()) return
        autonomy.failed(goal)
        throw err
      }
    })
    return true
  }

  let lastExplore = 0
  function explore() {
    if (Date.now() - lastExplore < EXPLORE_EVERY_MS) return false
    lastExplore = Date.now()
    const angle = Math.random() * 2 * Math.PI
    const target = bot.entity.position.offset(
      Math.cos(angle) * EXPLORE_DISTANCE,
      0,
      Math.sin(angle) * EXPLORE_DISTANCE
    )
    console.log(`[autônomo] sem meta disponível; explorando até ${Math.round(target.x)}, ${Math.round(target.z)}`)
    runTask('explorar', async () => {
      await food.goTo(
        bot,
        new goals.GoalXZ(Math.round(target.x), Math.round(target.z)),
        60000
      ).catch(() => {})
    })
    return true
  }

  function ownerNearby() {
    const owner = ownerEntity()
    return Boolean(owner) && owner.position.distanceTo(bot.entity.position) <= OWNER_NEAR
  }

  function spendNight() {
    lastNightTry = Date.now()
    runTask('passar a noite', async (isCancelled) => {
      const how = await night.spendNight(bot, isCancelled, {
        onShelter: (inside) => { sheltered = inside },
        say: (text) => bot.chat(text)
      })
      if (how && !isCancelled()) {
        bot.chat(how === 'dormi' ? 'Bom dia! Dormi bem.' : 'Amanheceu, saindo do abrigo.')
      }
    })
  }

  async function checkGear() {
    lastGearCheck = Date.now()
    if (checkingGear) return
    checkingGear = true
    try {
      const worn = await equipment.equipBestArmor(bot)
      if (worn.length) console.log(`Vesti ${worn.join(', ')}`)
      const upgrades = equipment.pendingUpgrades(bot)
      if (upgrades.length && mode === 'seguir') {
        runTask('melhorar equipamento', async (isCancelled) => {
          for (const item of upgrades) {
            if (isCancelled()) return
            await craft.craftItem(
              bot,
              item,
              craft.countItem(bot, bot.registry.itemsByName[item].id) + 1,
              isCancelled
            )
          }
        })
      }
    } catch (err) {
      console.log(`Equipamento: ${err.message}`)
    } finally {
      checkingGear = false
    }
  }

  function clearPatrolState() {
    patrolVersion++
    patrolActive = false
    patrolRoute = []
  }

  function travelTo(entry) {
    assertWaypointReachable(entry)
    autonomous = false
    clearPatrolState()
    persistSoon()
    bot.chat(`Indo para ${placeLabel(entry)}...`)
    runTask(`ir para ${entry.name}`, async (isCancelled) => {
      await goToPoint(entry.position, isCancelled, 2)
      if (!isCancelled()) bot.chat(`Cheguei em ${entry.name}.`)
    }, { resume: 'ficar' })
  }

  function startPatrol(entries) {
    for (const entry of entries) assertWaypointReachable(entry)
    autonomous = false
    const myPatrol = ++patrolVersion
    patrolActive = true
    patrolRoute = entries.map((entry) => entry.name)
    persistSoon()
    bot.chat(`Patrulha iniciada: ${patrolRoute.join(' -> ')}.`)

    runTask('patrulhar', async (isCancelled) => {
      try {
        while (!isCancelled() && patrolActive && patrolVersion === myPatrol) {
          for (const entry of entries) {
            if (isCancelled() || !patrolActive || patrolVersion !== myPatrol) return
            await goToPoint(entry.position, isCancelled, 2)
            if (isCancelled() || !patrolActive || patrolVersion !== myPatrol) return
            await new Promise((resolve) => setTimeout(resolve, 1200))
          }
        }
      } finally {
        if (patrolVersion === myPatrol) {
          patrolActive = false
          patrolRoute = []
        }
      }
    }, { resume: 'ficar' })
  }

  const isLiving = (entity) => entity && entity !== bot.entity && entity.isValid !== false

  // Luta com `target` até ele morrer; com vida baixa, recua.
  function defend(target) {
    // Já lutando com ele (defesa automática + !atacar): não reinicia a luta.
    if (mode === 'tarefa' && taskName === 'lutar' && fightTarget === target) return
    const resume = mode === 'ficar' || (mode === 'tarefa' && taskName === 'lutar' && fightResume === 'ficar') ? 'ficar' : 'seguir'
    if (mode === 'tarefa' && taskName !== 'lutar') bot.chat(`Parei de ${taskName} para lutar com ${target.name}.`)
    fightTarget = target
    fightResume = resume
    console.log(`Lutando com ${target.name} (HP ${Math.round(bot.health)})`)
    runTask('lutar', async (isCancelled) => {
      // Emenda lutas: matou um e há outro hostil perto, continua (se ainda compensa lutar).
      let current = target
      for (let fights = 0; current && fights < CHAIN_FIGHTS && !isCancelled(); fights++) {
        fightTarget = current
        const result = await combat.fight(bot, current, isCancelled)
        console.log(`Luta com ${current.name}: ${result}`)
        if (result === 'recuei') {
          flee(current)
          return
        }
        if (result !== 'morto') return
        const next = combat.proactiveTarget(bot, CHAIN_RANGE)
        await food.collectDrops(bot, current.position.clone(), isCancelled)
        current = next && next.isValid !== false && combat.decide(bot, next) === 'lutar' ? next : null
        if (current) console.log(`Próximo: ${current.name}`)
      }
    }, { resume })
  }

  // Reação a uma ameaça: lutar ou fugir, conforme o mob, a vida e quantos inimigos há.
  function react(attacker) {
    const threat = isLiving(attacker) ? attacker : nearestHostile(FLEE_DISTANCE)
    if (taskName === 'lutar' && threat === fightTarget) return
    if (threat && combat.decide(bot, threat) === 'lutar') defend(threat)
    else flee(threat)
  }

  // Anota o que o bot prometeu fazer; o estado final fica na memória.
  // fn retorna true (feito), false (falhou) ou undefined (interrompido).
  async function withCommitment(description, fn) {
    const item = memory.prometer(description, { para: ownerName() }, inferido())
    let ok
    try {
      ok = await fn()
    } finally {
      memory.encerrarCompromisso(item.id, ok === true ? 'feito' : ok === false ? 'falhou' : 'interrompido')
    }
  }

  function mine(blockNames, count) {
    const names = new Set(blockNames)
    const label = blockNames.length > 2 ? `${blockNames[0]} e parecidos` : blockNames.join('/')
    bot.chat(`Minerando ${count}x ${label}...`)
    withCommitment(`minerar ${count}x ${label}`, async () => {
      let result
      await runTask('minerar', async (isCancelled) => {
        const mined = await gather.mineBlocks(bot, (name) => names.has(name), count, isCancelled)
        if (isCancelled()) return
        result = mined >= count
        if (mined < count) bot.chat(`Só consegui ${mined}x ${label} (não achei mais ou não alcancei).`)
        else bot.chat(`Minerei ${mined}x ${label}.`)
      })
      return result
    }).catch(() => {})
  }

  async function eatNow() {
    if (eating) return
    eating = true
    try {
      const eaten = await food.eat(bot, { preferred: memory.preferencia('comida.preferida') || null })
      if (eaten) {
        console.log(`Comi ${eaten} (fome ${bot.food}/20)`)
        warnedNoFood = false
      }
      return eaten
    } catch (err) {
      console.log(`Não consegui comer: ${err.message}`)
    } finally {
      eating = false
    }
  }

  function searchFood(announce) {
    lastFoodSearch = Date.now()
    if (announce) bot.chat('Vou procurar comida.')
    runTask('buscar comida', async (isCancelled) => {
      // Continua até ter comida no inventário (máx. 5 fontes por busca).
      for (let i = 0; i < 5 && !food.hasFood(bot) && !isCancelled(); i++) {
        const done = await food.gatherFood(bot, isCancelled)
        if (!done) {
          if (!isCancelled() && i === 0) bot.chat('Não achei comida por perto (animais, plantações ou frutas).')
          break
        }
        console.log(`Busca de comida: ${done}`)
        if (food.hasFood(bot)) bot.chat(`Consegui comida: ${done}.`)
      }
      if (!isCancelled() && food.hasFood(bot)) await eatNow()
    })
  }

  // Laço e reflexos do companheiro. Chamado uma vez, logo depois de criar.
  function start() {
    bot.on('spawn', () => {
      followMoves = new Movements(bot)
      followMoves.canDig = false          // não quebra construções enquanto segue
      followMoves.allow1by1towers = false
      workMoves = new Movements(bot)
      bot.pathfinder.thinkTimeout = 10000 // caminhos até blocos subterrâneos demoram a calcular
    })

    bot.once('health', () => {
      console.log(`HP: ${Math.round(bot.health * 10) / 10}/20 | Fome: ${bot.food}/20`)
    })

    bot.on('entityHurt', (entity, source) => {
      if (entity === bot.entity && source) lastAttacker = source
    })

    bot.on('health', () => {
      // Sufocando (areia/cascalho caiu na cabeça): cava o bloco da cabeça na hora.
      const head = bot.blockAt(bot.entity.position.offset(0, 1.6, 0))
      if (lastHealth !== null && bot.health < lastHealth && head?.boundingBox === 'block' && bot.canDigBlock(head)) {
        console.log(`Sufocando em ${head.name}: cavando para sair`)
        bot.dig(head).catch(() => {})
        lastHealth = bot.health
        return
      }

      // Durante a luta, o próprio laço de combate decide quando recuar.
      if (lastHealth !== null && bot.health < lastHealth && bot.health > 0 && taskName !== 'lutar') {
        react(lastAttacker)
        lastAttacker = null
      }
      lastHealth = bot.health
    })

    bot.on('death', () => {
      console.log('O bot morreu.')
      cancelTask()
      sheltered = false
      lastHealth = null
      fleeingUntil = 0
    })

    // Laço principal: termina fugas, foge preventivamente e mantém o bot perto do dono.
    setInterval(() => {
      if (!bot.entity || !followMoves) return
      if (fleeingUntil) {
        if (Date.now() < fleeingUntil) return
        fleeingUntil = 0
        if (mode === 'ficar') bot.pathfinder.setGoal(null)
      }
      // Defesa: foge de creepers e reage a hostis que chegam perto.
      if (taskName !== 'lutar' && !sheltered) {
        const creeper = bot.nearestEntity((e) => combat.EXPLOSIVE.has(e.name) &&
          e.position.distanceTo(bot.entity.position) <= CREEPER_RANGE)
        if (creeper) {
          flee(creeper)
          return
        }
        const target = combat.proactiveTarget(bot, DEFEND_RANGE)
        if (target) {
          react(target)
          return
        }
      }
      // Correr gasta muita fome; com pouca comida, só anda.
      followMoves.allowSprinting = workMoves.allowSprinting = bot.food > 6

      // Fome: come se tiver comida; senão, sai para buscar (só quando está livre).
      const needsFood = bot.food <= HUNGRY || (bot.food < 18 && bot.health < 20)
      if (needsFood && !eating && (mode !== 'tarefa' || bot.food <= 6) && food.hasFood(bot)) {
        eatNow()
      } else if (bot.food <= HUNGRY && mode === 'seguir' && !food.hasFood(bot) &&
          Date.now() - lastFoodSearch > FOOD_RETRY_MS) {
        lastFoodSearch = Date.now()
        if (food.findFoodSource(bot)) {
          searchFood(true)
          return
        }
        if (!warnedNoFood) bot.chat('Estou com fome e não acho comida por perto. Me leve até animais ou plantações, ou me dê comida.')
        warnedNoFood = true
      }
      if (mode !== 'seguir' || eating) return

      if (night.isNight(bot) && (autonomous || !ownerNearby()) &&
          Date.now() - lastNightTry > NIGHT_RETRY_MS) {
        spendNight()
        return
      }

      if (Date.now() - lastGearCheck > GEAR_CHECK_MS) {
        checkGear()
        if (mode !== 'seguir') return
      }

      if (autonomous) {
        if (!autonomyStep() && !explore()) bot.pathfinder.setGoal(null)
        return
      }

      const owner = ownerEntity()
      if (owner && bot.pathfinder.goal?.entity !== owner) follow()
    }, 500)
  }

  return {
    get mode() { return mode },
    set mode(value) { mode = value },
    get taskName() { return taskName },
    get autonomous() { return autonomous },
    set autonomous(value) { autonomous = value },
    get patrolActive() { return patrolActive },
    get patrolRoute() { return patrolRoute },
    get resolvedOwner() { return resolvedOwner },
    set resolvedOwner(value) { resolvedOwner = value },
    autonomy,
    start,
    ownerName,
    ownerEntity,
    follow,
    cancelTask,
    flee,
    withoutFollowing,
    runTask,
    clearPatrolState,
    travelTo,
    startPatrol,
    defend,
    withCommitment,
    mine,
    eatNow,
    searchFood
  }
}

module.exports = { createCompanion }
