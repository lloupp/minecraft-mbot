// core/worker/player-loop.js
// Player loop do explorador e preparação determinística (staging local, retorno ao sítio).
// Métodos do WorkerController (aplicados ao prototype em core/WorkerController.js).

const { goals } = require('mineflayer-pathfinder')
const food = require('../../lib/food')
const gather = require('../../lib/gather')
const combat = require('../../lib/combat')
const { pointInsidePen } = require('../AnimalPen')
const { candidateIntents, deterministicPlayerPolicy, bestWeapon } = require('../../lib/player-loop')
const night = require('../../lib/night')
const craft = require('../../lib/craft')
const { preparationRadius, preparationIntegrationPreflight, preparationIntegrationTask, preparationStateSnapshot } = require('../../lib/forced-preparation')
const { HUNGRY, FLEE_DISTANCE, PREPARATION_SITE_TTL_MS, PREPARATION_SITE_MAX_DISTANCE, PREPARATION_STAGING_MAX_DISTANCE, PREPARATION_STAGING_SAFETY_POLL_MS, EXPLORE_FAR_MARGIN, FAILED_HUNT_MS, BASE_UNREACHABLE_MS, SHELTER_BLOCKED_MS, INVENTORY_DESYNC, COOKABLE, PHYSICAL_PREPARATION_REFUSALS, travelTimeoutMs } = require('./shared')

class PlayerLoopBehavior {
  nearbyPreparationAllowlist(maxDistance = preparationRadius(), maxTargets = 32) {
    if (typeof this.bot.findBlocks !== 'function') return []
    const blocks = this.bot.registry?.blocksArray || []
    const idsFor = (predicate) => blocks.filter((block) => predicate(block.name)).map((block) => block.id)
    const isStone = (name) => name === 'stone' || name === 'cobblestone'
    const isLog = (name) => name.endsWith('_log')

    // findBlocks devolve os mais próximos primeiro: em terreno natural eles são pedras enterradas ou um
    // afloramento grande que esgotaria a cota e deixaria as árvores de fora. Duas varreduras limitadas,
    // uma por recurso, mantendo só candidatos expostos e no máximo metade da cota para cada.
    const seen = new Set()
    const scan = (predicate, scanCount, cap) => {
      const matching = idsFor(predicate)
      if (!matching.length) return []
      const found = []
      for (const position of this.bot.findBlocks({ matching, maxDistance, count: scanCount }) || []) {
        if (!position || found.length >= cap) break
        const key = position.toString()
        if (seen.has(key)) continue
        const block = this.bot.blockAt?.(position)
        if (!block || !predicate(block.name)) continue
        if (!gather.isExposed(this.bot, position) || gather.hasFallingAbove(this.bot, position)) continue
        seen.add(key)
        found.push({ x: position.x, y: position.y, z: position.z, name: block.name })
      }
      return found
    }
    const half = Math.floor(maxTargets / 2)
    return [...scan(isLog, maxTargets * 4, half), ...scan(isStone, maxTargets * 8, maxTargets - half)]
  }

  // Depois de uma ameaça interromper a preparação, a defesa pode deslocar o bot para fora da janela
  // local. Uma única volta ao local validado (nunca busca nova); o resto é reavaliado pelo snapshot real.
  async returnToPreparationSite(task, isCancelled) {
    const site = this._preparationSite
    if (!site || isCancelled()) return
    if (Date.now() - site.at > PREPARATION_SITE_TTL_MS) { this._preparationSite = null; return }
    const state = preparationStateSnapshot(this.bot, task, { homeProvider: this.homeProvider, allowedTargets: [], isCancelled })
    if (state.threat) return // ameaça ainda presente: mantém o local até o TTL
    this._preparationSite = null
    if (state.equippedWeapon) return
    const distance = this.bot.entity.position.distanceTo(site.position)
    if (distance <= 0.5 || distance > PREPARATION_SITE_MAX_DISTANCE) return
    try {
      await this.goTo(new goals.GoalBlock(Math.floor(site.position.x), Math.floor(site.position.y), Math.floor(site.position.z)), 15000)
    } catch { /* sem caminho: segue com o snapshot real da posição atual */ }
  }

  async tryLocalPreparationStaging(isCancelled) {
    if (isCancelled() || !this.production?.findCraftingTable || !this.bot?.entity?.position) return false

    const table = this.production.findCraftingTable(this.bot, PREPARATION_STAGING_MAX_DISTANCE)
    if (!table?.position) return false

    const liveTable = this.bot.blockAt?.(table.position)
    if (liveTable?.name !== 'crafting_table') return false

    const distance = this.bot.entity.position.distanceTo(table.position)
    if (distance > PREPARATION_STAGING_MAX_DISTANCE) return false

    // The cache is only a hint; the physical executor/preflight still revalidates
    // the block and distance before every craft.
    this.production.rememberCraftingTable?.(this.bot, liveTable)

    // If we are already adjacent, another movement would add no useful physical
    // information. Let the normal fail-closed fallback handle the refusal.
    if (distance <= 1.5) return false

    let stagingThreat = null
    let defenseStarted = false
    const detectThreat = () => {
      if (stagingThreat || isCancelled() || !this.bot?.entity?.position) return
      const threat = this.bot.nearestEntity?.((entity) =>
        entity?.type === 'hostile' &&
        entity.position?.distanceTo(this.bot.entity.position) <= FLEE_DISTANCE
      )
      if (!threat) return

      stagingThreat = threat
      // Cancel the navigation immediately. defend() synchronously invalidates
      // taskVersion before its first await, so the old explore owner cannot
      // start another physical action after this point.
      this.bot.pathfinder?.setGoal(null)
      if (!defenseStarted && !this.defending) {
        defenseStarted = true
        this.defend(threat).catch((err) =>
          this.logger.log?.(`[colônia] ${this.name} defesa durante staging: ${err.message}`)
        )
      }
    }

    detectThreat()
    if (stagingThreat || isCancelled()) return false

    const monitor = setInterval(detectThreat, PREPARATION_STAGING_SAFETY_POLL_MS)
    try {
      await this.goTo(
        new goals.GoalNear(
          Math.floor(table.position.x),
          Math.floor(table.position.y),
          Math.floor(table.position.z),
          1
        ),
        10000
      )
    } catch {
      return false
    } finally {
      clearInterval(monitor)
    }

    detectThreat()
    if (stagingThreat || isCancelled()) return false
    const after = this.bot.blockAt?.(table.position)
    if (after?.name !== 'crafting_table') return false
    return this.bot.entity.position.distanceTo(table.position) <= 2
  }

  async runExplorePlayerLoop(task, isCancelled) {
    if (!this.juliaAuthority?.enabled?.()) return this._runExplorePlayerLoop(task, isCancelled)
    let result = null
    try {
      result = await this._runExplorePlayerLoop(task, isCancelled)
      return result
    } catch (error) {
      result = { ok: false, code: 'ERROR', error: error?.message || String(error) }
      throw error
    } finally {
      this._settleJuliaDecision(task, result)
    }
  }

  // Escolha do player loop: Julia (se autorizada) entre os candidatos dados, senão a política determinística.
  async _playerLoopChoice(state, candidates, isCancelled) {
    if (!this.juliaAuthority?.enabled?.()) return { choice: deterministicPlayerPolicy(state, candidates), source: 'deterministic' }
    return this.juliaAuthority.decide({ state, candidates, isCancelled, meta: { worker: this.name, taskVersion: this.taskVersion } })
  }

  _settleJuliaDecision(task, result, action = null) {
    if (!this.juliaAuthority?.enabled?.()) return
    let nextState = null
    try { nextState = preparationStateSnapshot(this.bot, task, { homeProvider: this.homeProvider, allowedTargets: [] }) } catch { nextState = null }
    const executed = action || (result?.intent === 'cook_food' ? `cook:${result.cooked ?? 0}` : result?.intent === 'recover_items' ? `recover:${result.recovered ?? 0}` : result?.escaped ? `escape:${result.escaped}` : result?.intent === 'sleep_or_shelter' ? `night:${result.night || 'failed'}` : result?.intent === 'equip_best_weapon' && result?.equipped !== undefined ? `equip:${result.equipped || 'failed'}` : result?.intent === 'make_bed' ? `bed:${result.bed || 'failed'}` : result?.intent === 'find_food' ? `find_food:${result.foodGathered ? 'got' : 'none'}${result.ate ? '+ate' : ''}` : result?.threatHandled ? `threat:${result.threatHandled}:${result.combat}` : result?.returnedToBase ? 'return_base'
      : result?.code === 'PLAYER_LOOP_PREEMPTED' ? 'none_preempted'
        : Number.isFinite(result?.x) ? 'explore' : result?.preparationSkipped ? 'explore_after_preparation_refused' : null)
    this.juliaAuthority.settle(this.name, { action: executed, result, nextState })
  }

  async _runExplorePlayerLoop(task, isCancelled) {
    if (process.env.MBOT_EXPLORE_PREPARATION !== '1') {
      return this.explore(task.radius || 64, isCancelled, task.center || null)
    }

    const preparationSteps = []
    const maxPreparationSteps = 3
    let stagingAttempted = false
    let memoryTripAttempted = false
    // Muito além do raio de exploração (ex.: respawn no spawn do mundo): os alvos são relativos ao
    // centro, então primeiro volta a ele com o retorno existente em vez de falhar caminhando 300+ blocos.
    const center = task.center || this.homeProvider?.()
    const farLimit = (task.radius || 64) + EXPLORE_FAR_MARGIN
    if (center && this.bot.entity?.position && Math.hypot(this.bot.entity.position.x - center.x, this.bot.entity.position.z - center.z) > farLimit) {
      const returned = await this.returnHome(isCancelled, { verify: true })
      if (!returned.ok) return { ok: false, code: returned.code || 'CANCELLED', cancelled: !returned.code, preparationSteps }
    }
    await this.returnToPreparationSite(task, isCancelled)

    for (let step = 0; step < maxPreparationSteps;) {
      if (isCancelled()) return { ok: false, code: 'CANCELLED', cancelled: true, preparationSteps }

      const allowedTargets = this.nearbyPreparationAllowlist()
      const state = preparationStateSnapshot(this.bot, task, {
        homeProvider: this.homeProvider,
        allowedTargets,
        isCancelled,
        deep: true,
        ignoreThreat: (e) => this.threatIgnored(e),
        spareAnimal: (e) => this.huntFailed(e)
      })
      this.rememberedFoodHint(state)
      this.bedFacts(state)
      const candidates = candidateIntents(state)
      const decision = await this._playerLoopChoice(state, candidates, isCancelled)
      if (decision.cancelled || isCancelled()) return { ok: false, code: 'CANCELLED', cancelled: true, preparationSteps }
      const choice = decision.choice
      this._loopIntent = choice
      const authorizedIntent = decision.source === 'julia' ? choice : null

      if (choice === 'continue_objective') {
        const explored = await this.explore(task.radius || 64, isCancelled, task.center || null, { groundAware: true })
        return {
          ...explored,
          playerLoopPreparation: true,
          preparationSteps
        }
      }

      // Noite desarmado (ou outra necessidade de voltar): o retorno à base já existe (tarefa `voltar`);
      // sem ele o explorador ficaria parado fora da base. Um único retorno, sob o mesmo owner.
      if (choice === 'return_base' && this.homeProvider?.()) {
        const returned = await this.returnHome(isCancelled, { verify: true })
        if (returned.code === 'NOT_ARRIVED') this._baseUnreachableUntil = Date.now() + BASE_UNREACHABLE_MS
        return returned.ok
          ? { ok: true, returnedToBase: true, intent: choice, playerLoopPreparation: true, preparationSteps }
          : { ok: false, code: returned.code || 'CANCELLED', cancelled: !returned.code, intent: choice, preparationSteps }
      }

      // Afogando (sem ameaça): sair da água para o chão firme mais próximo. O player loop já forçava escape_danger com
      // drowning, mas o runtime nunca informava drowning e não havia executor (visto no Minecraft: afogou repetindo
      // make_bed parado na água).
      if (choice === 'escape_danger' && !state.threat && state.drowning) {
        const out = await this.escapeWater(isCancelled)
        if (isCancelled()) return { ok: false, code: 'CANCELLED', cancelled: true, preparationSteps }
        return { ok: out, code: out ? null : 'STILL_IN_WATER', intent: choice, escaped: 'water', playerLoopPreparation: true, preparationSteps }
      }

      // Ameaça: fugir ou lutar vai para os executores determinísticos que já existem (flee / combat.fight).
      // Sem isto o loop só devolvia PLAYER_LOOP_PREEMPTED e, sem dano para acionar o reflexo, ficava parado ao lado
      // da ameaça (visto no Minecraft: 103 ciclos idênticos perto de uma aranha).
      if ((choice === 'escape_danger' || choice === 'fight_threat') && state.threat) {
        const threat = this.bot.nearestEntity?.((entity) => entity?.type === 'hostile' && entity.name === state.threat.type &&
          !this.threatIgnored(entity) && entity.position?.distanceTo(this.bot.entity.position) <= FLEE_DISTANCE)
        if (threat) {
          if (!state.equippedWeapon && (state.nearby?.wood || state.nearby?.stone)) {
            this._preparationSite = { position: this.bot.entity.position.clone(), at: Date.now() }
          }
          let outcome = 'fugi'
          if (choice === 'fight_threat') {
            outcome = await combat.fight(this.bot, threat, isCancelled)
            // Luta expirou sem alcançar o monstro (na água, num buraco, sem caminho): ignora-o por um minuto na
            // percepção e se afasta. Visto no Minecraft: 26× fight_threat → 'tempo' no mesmo lugar por 25 min.
            if (outcome === 'tempo') this.ignoreThreat(threat)
            // Monstro abatido: recolhe o que caiu (linha de aranha vira lã branca para a cama; ossos, flechas).
            if (outcome === 'morto' && !isCancelled() && threat.position) {
              await food.collectDrops(this.bot, threat.position.clone(), isCancelled, { radius: 6, timeoutMs: 6000 }).catch(() => {})
            }
            if ((outcome === 'recuei' || outcome === 'tempo') && !isCancelled()) await this.flee(threat, isCancelled)
          } else {
            const before = this.bot.entity.position.clone()
            const healthBefore = this.bot.health
            await this.flee(threat, isCancelled)
            // Fugiu e não saiu do lugar, sem levar dano: o monstro não alcança o bot nem o bot se afasta dele (buraco,
            // parede). Ignora-o por um minuto. Visto no Minecraft: 10 min de escape_danger parado no mesmo ponto.
            if (!isCancelled() && this.bot.entity.position.distanceTo(before) < 2 && this.bot.health >= healthBefore) {
              this.ignoreThreat(threat)
              outcome = 'preso'
            }
          }
          this.bot.pathfinder?.setGoal(null)
          if (isCancelled()) return { ok: false, code: 'CANCELLED', cancelled: true, preparationSteps }
          return { ok: true, intent: choice, threatHandled: choice, combat: outcome, playerLoopPreparation: true, preparationSteps }
        }
      }

      // Arma carregada sob ameaça: o player loop só oferece equipar com a ameaça a ≥5 blocos. O executor de preparação
      // recusa qualquer etapa com ameaça (SAFETY_PRECEDENCE) e a escolha válida não tinha efeito (r3: 10×). Equipar é uma
      // única ação: feita aqui, confirmada na mão; a etapa de preparação continua recusando o resto sob ameaça.
      if (choice === 'equip_best_weapon' && state.threat) {
        const name = bestWeapon(state).name
        const item = name && this.bot.inventory.items().find((i) => i.name === name)
        if (item && !isCancelled()) await this.bot.equip(item, 'hand').catch(() => {})
        if (isCancelled()) return { ok: false, code: 'CANCELLED', cancelled: true, preparationSteps }
        const equipped = this.bot.heldItem?.name === name
        return { ok: equipped, code: equipped ? null : 'EQUIP_NOT_CONFIRMED', intent: choice, equipped: equipped ? name : null, playerLoopPreparation: true, preparationSteps }
      }

      // Noite: abrigo/cama usa o executor que já existe (lib/night.js: dorme numa cama a ≤32 ou cava um abrigo de 3 blocos,
      // tampa e espera o dia). Antes não havia executor: ficar parado na base a noite inteira (r3: 102×) e phantoms (6 mortes).
      if (choice === 'sleep_or_shelter') {
        // Cama da base fora do alcance do executor (32): volta à base primeiro (o mesmo retorno de return_base).
        if (state.shelterKind === 'base_bed' && !night.findBed(this.bot)) {
          const returned = await this.returnHome(isCancelled, { verify: true })
          if (isCancelled()) return { ok: false, code: 'CANCELLED', cancelled: true, preparationSteps }
          if (!returned.ok) this.logger.log?.(`[colônia] ${this.name} noite: não cheguei à cama da base (${returned.code})`)
        }
        const how = await night.spendNight(this.bot, isCancelled, { onShelter: (inside) => { this._sheltered = inside } })
          .catch((error) => {
            this.logger.log?.(`[colônia] ${this.name} noite: ${error.message}`)
            // Não chegou a nenhum lugar: o bot é que está preso. Abrigo fora das opções por 2 min (o loop faz outra
            // coisa, como explorar com escape cavando). Visto no Minecraft: 90 'não cheguei ao lugar do abrigo' seguidos.
            if (/não cheguei|caminho demorou|No path/.test(error.message)) this._shelterBlockedUntil = Date.now() + SHELTER_BLOCKED_MS
            return null
          })
        if (isCancelled()) return { ok: false, code: 'CANCELLED', cancelled: true, preparationSteps }
        return { ok: Boolean(how), code: how ? null : 'SHELTER_FAILED', intent: choice, night: how, playerLoopPreparation: true, preparationSteps }
      }

      // Cozinhar: o smeltItem que já existe (faz/acha a fornalha, põe combustível e espera). Depois come se tiver fome.
      if (choice === 'cook_food') {
        let cooked = 0
        for (const item of this.bot.inventory.items().filter((i) => COOKABLE.has(i.name))) {
          if (isCancelled()) break
          cooked += await craft.smeltItem(this.bot, item.name, item.count, isCancelled)
            .catch((error) => { this.logger.log?.(`[colônia] ${this.name} cozinhar: ${error.message}`); return 0 })
        }
        if (isCancelled()) return { ok: false, code: 'CANCELLED', cancelled: true, preparationSteps }
        const ate = this.bot.food <= HUNGRY ? await this.eat() : null
        return { ok: cooked > 0, code: cooked > 0 ? null : 'COOK_FAILED', intent: choice, cooked, ate: Boolean(ate), playerLoopPreparation: true, preparationSteps }
      }

      // Itens da morte: vai até o ponto e recolhe o que ainda estiver no chão (o coletor de drops que já existe).
      if (choice === 'recover_items' && this._deathDrops) {
        const drops = this._deathDrops
        const before = this.bot.inventory.items().reduce((n, i) => n + i.count, 0)
        await this.goTo(new goals.GoalNear(drops.position.x, drops.position.y, drops.position.z, 2), travelTimeoutMs(this.bot.entity?.position, drops.position)).catch(() => {})
        if (!isCancelled()) await food.collectDrops(this.bot, drops.position, isCancelled, { radius: 8, timeoutMs: 20000 }).catch(() => {})
        if (isCancelled()) return { ok: false, code: 'CANCELLED', cancelled: true, preparationSteps }
        this._deathDrops = null
        const gained = this.bot.inventory.items().reduce((n, i) => n + i.count, 0) - before
        return { ok: gained > 0, intent: choice, recovered: gained, playerLoopPreparation: true, preparationSteps }
      }

      // Cama na base: lã (ovelha ou linha), fabricar, voltar à base, colocar e usar (ponto de renascimento / dormir).
      if (choice === 'make_bed') {
        const outcome = await this.makeBaseBed(isCancelled, state.nearby?.sheepRemembered || null)
          .catch((error) => ({ ok: false, step: 'error', error: error?.message || String(error) }))
        if (isCancelled()) return { ok: false, code: 'CANCELLED', cancelled: true, preparationSteps }
        if (outcome.error) this.logger.log?.(`[colônia] ${this.name} cama (${outcome.step}): ${outcome.error}`)
        return { ok: outcome.ok, code: outcome.ok ? null : 'BED_FAILED', intent: choice, bed: outcome.step, error: outcome.error || null, playerLoopPreparation: true, preparationSteps }
      }

      // Fome: procurar comida usa o executor de comida que já existe (caça/frutas/plantação ao alcance) e come.
      if (choice === 'find_food') {
        const pens = this.builtPens()
        const spare = (entity) => pens.some((plan) => pointInsidePen(entity.position, plan)) || this.huntFailed(entity)
        const hunt = () => food.gatherFood(this.bot, isCancelled, { spare })
          .catch((error) => { this.logger.log?.(`[colônia] ${this.name} comida: ${error.message}`); return null })
        // O alvo que o executor vai escolher (o mesmo findHuntableAnimal): sem comida no fim, fica fora por 2 min.
        // Visto no Minecraft: preso numa caverna, 118 find_food no mesmo animal inalcançável, fome 0 por 41 min.
        let target = null
        try { target = food.findHuntableAnimal(this.bot, { spare }) } catch { target = null }
        let gathered = await hunt()
        if (!gathered && target && !isCancelled()) (this._failedHunts ||= new Map()).set(target.id, Date.now() + FAILED_HUNT_MS)
        const remembered = state.nearby?.foodRemembered
        if (!gathered && remembered && !isCancelled()) gathered = await this.huntRememberedFood(remembered, hunt, isCancelled)
        if (isCancelled()) return { ok: false, code: 'CANCELLED', cancelled: true, preparationSteps }
        const ate = await this.eat()
        return { ok: Boolean(gathered), intent: choice, foodGathered: gathered || null, ate: Boolean(ate), playerLoopPreparation: true, preparationSteps }
      }

      if (!['gather_materials', 'prepare_combat', 'equip_best_weapon'].includes(choice)) {
        // Ameaça antes da preparação: lembra o local (desarmado + recursos ao alcance) para uma volta única depois.
        if (state.threat && !state.equippedWeapon && (state.nearby?.wood || state.nearby?.stone)) {
          this._preparationSite = { position: this.bot.entity.position.clone(), at: Date.now() }
        }
        return {
          ok: false,
          code: 'PLAYER_LOOP_PREEMPTED',
          intent: choice,
          candidates: candidates.map((candidate) => candidate.id),
          preparationSteps
        }
      }

      if (process.env.MBOT_DETERMINISTIC_PREPARATION !== '1') {
        return {
          ok: false,
          code: 'PREPARATION_EXECUTOR_DISABLED',
          intent: choice,
          preparationSteps
        }
      }

      // O preflight só aceita mesa já em cache; registra uma mesa real a ≤4 blocos (sem busca ampla).
      if (!this.production.cachedCraftingTable?.(this.bot)) {
        const nearbyTable = this.production.findCraftingTable?.(this.bot, 4)
        if (nearbyTable) this.production.rememberCraftingTable(this.bot, nearbyTable)
      }

      const preflight = preparationIntegrationPreflight({
        bot: this.bot,
        production: this.production,
        state,
        allowedTargets,
        authorizedIntent
      })
      if (!preflight.ok) {
        if (preflight.code === 'SAFETY_PRECEDENCE') {
          return { ok: false, code: preflight.code, intent: choice, preparationSteps }
        }

        // One bounded staging move is allowed only for spatial refusals. This is
        // not a resource search: it approaches one existing crafting table at
        // <= 8 blocks, then rebuilds the allowlist/snapshot and re-runs preflight.
        if (!stagingAttempted &&
            ['NEARBY_TABLE_REQUIRED', 'APPROVED_TARGETS_INSUFFICIENT'].includes(preflight.code)) {
          stagingAttempted = true
          if (await this.tryLocalPreparationStaging(isCancelled)) continue
          if (isCancelled()) return { ok: false, code: 'CANCELLED', cancelled: true, preparationSteps }
        }

        // Local esgotado: a memória pode conhecer um ponto com mesa+madeira+pedra. Uma viagem por tarefa;
        // depois o loop reavalia tudo do zero (snapshot real, allowlist, preflight físico).
        if (!memoryTripAttempted && this.memoryGuideOn() &&
            ['NEARBY_TABLE_REQUIRED', 'APPROVED_TARGETS_INSUFFICIENT'].includes(preflight.code)) {
          memoryTripAttempted = true
          if (await this.tryRememberedPreparationSite(isCancelled)) continue
          if (isCancelled()) return { ok: false, code: 'CANCELLED', cancelled: true, preparationSteps }
        }

        // Sem condições físicas para preparar aqui: não é erro da tarefa.
        // Segue o caminho clássico em vez de deixar o explorador parado.
        const explored = await this.explore(task.radius || 64, isCancelled, task.center || null, { groundAware: true })
        return {
          ...explored,
          playerLoopPreparation: true,
          preparationSkipped: { code: preflight.code || 'PREPARATION_PREFLIGHT_REFUSED', intent: choice },
          preparationSteps
        }
      }

      const preparationTask = preparationIntegrationTask({
        enabled: true,
        bot: this.bot,
        production: this.production,
        state,
        objective: task,
        allowedTargets,
        authorizedIntent,
        // A caminhada de aproximação (até 8 s) do modo raio >4 faz parte da etapa: sem ela, 2 de 8 rodadas
        // estouravam 20 s com o gather quase pronto (8 s de caminhada + dig + pickup + 2 pedras).
        timeoutMs: 20000 + (preparationRadius() > 4 ? 8000 : 0)
      })
      if (!preparationTask) {
        return {
          ok: false,
          code: 'PREPARATION_TASK_NOT_CREATED',
          intent: choice,
          preparationSteps
        }
      }

      const ownerVersion = this.taskVersion
      const siteBefore = this.bot.entity.position.clone()
      const preparationPromise = this.runDeterministicPreparation(preparationTask, isCancelled)
      this._preparationDrain = preparationPromise
      try {
        const result = await preparationPromise
        preparationSteps.push({
          intent: choice,
          ok: result?.ok === true,
          code: result?.code || null,
          ownerVersion
        })
        if (!result?.ok) {
          if (result?.code === 'THREAT') this._preparationSite = { position: siteBefore, at: Date.now() }
          // Fabricação que não bateu com o inventário: o inventário local pode ter dessincronizado (depois disso cada
          // equip esperava 20 s — visto no Minecraft: 11 abrigos falharam e 10 min parado). Ressincroniza com o servidor.
          if (INVENTORY_DESYNC.test(result?.code || result?.error || '')) await this.resyncInventory()
          // Recusa física do executor (alvo coberto por folhas, falta de alvos/picareta/mesa): nada deu errado
          // na tarefa; segue a exploração clássica em vez de virar falha com backoff exponencial.
          if (PHYSICAL_PREPARATION_REFUSALS.has(result?.code)) {
            const explored = await this.explore(task.radius || 64, isCancelled, task.center || null, { groundAware: true })
            return {
              ...explored,
              playerLoopPreparation: true,
              preparationSkipped: { code: result.code, intent: choice, afterStep: true },
              preparationSteps
            }
          }
          return {
            ...result,
            playerLoopPreparation: true,
            preparationSteps
          }
        }
        this._settleJuliaDecision(task, result, `preparation:${choice}`)
        step++
      } finally {
        if (this._preparationDrain === preparationPromise) this._preparationDrain = null
      }
    }

    const finalTargets = this.nearbyPreparationAllowlist()
    const finalState = preparationStateSnapshot(this.bot, task, {
      homeProvider: this.homeProvider,
      allowedTargets: finalTargets,
      isCancelled,
      deep: true,
      ignoreThreat: (e) => this.threatIgnored(e),
      spareAnimal: (e) => this.huntFailed(e)
    })
    this.rememberedFoodHint(finalState)
    this.bedFacts(finalState)
    const finalCandidates = candidateIntents(finalState)
    const finalDecision = await this._playerLoopChoice(finalState, finalCandidates, isCancelled)
    if (finalDecision.cancelled || isCancelled()) return { ok: false, code: 'CANCELLED', cancelled: true, preparationSteps }
    const finalChoice = finalDecision.choice
    if (finalChoice === 'continue_objective') {
      const explored = await this.explore(task.radius || 64, isCancelled, task.center || null, { groundAware: true })
      return { ...explored, playerLoopPreparation: true, preparationSteps }
    }

    return {
      ok: false,
      code: 'PREPARATION_STEP_LIMIT',
      intent: finalChoice,
      candidates: finalCandidates.map((candidate) => candidate.id),
      preparationSteps
    }
  }
}

module.exports = { PlayerLoopBehavior }
