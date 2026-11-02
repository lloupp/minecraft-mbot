// @ts-check
// core/worker/pens.js
// Currais e animais: construir, entrar/sair, portão, atrair, capturar, reproduzir, produtos.
// Métodos do WorkerController (aplicados ao prototype em core/WorkerController.js).

const { goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const food = require('../../lib/food')
const husbandry = require('../../lib/husbandry')
const animalProducts = require('../../lib/animalProducts')
const { groundedPenPlan, pointInsidePen, inspectAnimalPen, SPECIES_OFFSETS } = require('../AnimalPen')
const { sleep, NATURAL_TERRAIN } = require('./shared')

class PensBehavior {
  // Currais construídos (com portão) em volta da base.
  /** @this {import('./shared').Worker} */
  builtPens() {
    const home = this.homeProvider?.()
    if (!home) return []
    return Object.keys(SPECIES_OFFSETS)
      .map((species) => groundedPenPlan(this.bot, home, species))
      .filter((plan) => inspectAnimalPen(this.bot, plan).gatePresent)
  }

  /** @this {import('./shared').Worker} */
  async farm(count, isCancelled) {
    // Os animais do curral são o rebanho: caçar comida não pode abatê-los
    // (visto no 1.20.1: !colonia auto esvaziou o curral de vacas com meta 6).
    const pens = this.builtPens()
    const spare = (entity) => pens.some((plan) => pointInsidePen(entity.position, plan))
    let gathered = 0
    while (gathered < count && !isCancelled()) {
      const result = await food.gatherFood(this.bot, isCancelled, { spare })
      if (!result) break
      gathered++
    }
    const deposited = this.storage?.configured()
      ? await this.storage.depositCargo(this.bot).catch((err) => { this.logger.log(`[estoque] ${this.name} não depositou: ${err.message}`); return {} })
      : {}
    return { ok: gathered > 0, gathered, requested: count, resource: 'comida', exhausted: gathered < count, deposited }
  }

  /** @this {import('./shared').Worker} */
  penContext(species) {
    const canonical = husbandry.normalizeSpecies(species) || species
    const home = this.homeProvider?.()
    if (!home) return null
    const plan = groundedPenPlan(this.bot, home, canonical)
    const status = inspectAnimalPen(this.bot, plan)
    return { canonical, plan, status }
  }

  // Limita a seleção de animais aos que estão dentro do curral.
  /** @this {import('./shared').Worker} */
  penScope(pen) {
    return {
      center: new Vec3(pen.plan.center.x, pen.plan.center.y, pen.plan.center.z),
      range: pen.plan.size + 2,
      filter: (entity) => pointInsidePen(entity.position, pen.plan)
    }
  }

  // Busca a ração ANTES de entrar no curral: lá dentro, ir ao baú faria o
  // pathfinder abrir caminho pela cerca (o portão fica fechado atrás do bot).
  /** @this {import('./shared').Worker} */
  async penFeed(canonical, count) {
    const config = husbandry.SPECIES[canonical]
    if (!config || count < 2) return null
    return husbandry.ensureFeed(this.bot, config, count, this.storage)
  }

  /** @this {import('./shared').Worker} */
  penPopulation(species) {
    const pen = this.penContext(species)
    if (!pen) return { species, built: false, inside: 0, status: null }
    const inside = husbandry.selectAnimals(this.bot, pen.canonical, this.penScope(pen)).length
    return {
      species: pen.canonical,
      built: pen.status.built,
      inside,
      status: pen.status
    }
  }

  /** @this {import('./shared').Worker} */
  async breedAnimals(species, pairs, isCancelled) {
    const pen = this.penContext(species)
    if (!pen?.status?.built) {
      return husbandry.breed(this.bot, species, pairs, isCancelled, {
        storage: this.storage
      })
    }

    const scope = this.penScope(pen)
    const wanted = Math.max(1, Math.min(16, Number.parseInt(pairs, 10) || 1))
    const breedable = husbandry.selectAnimals(this.bot, pen.canonical, scope)
      .filter((entity) => husbandry.canBreed(this.bot, entity))
    const feed = await this.penFeed(pen.canonical, Math.min(wanted * 2, breedable.length - (breedable.length % 2)))
    // Sem par ou sem ração: breed (sem estoque) só informa o motivo, sem sair do lugar.
    if (!feed) return husbandry.breed(this.bot, species, pairs, isCancelled, scope)

    return this.withAnimalPen(pen, isCancelled, () =>
      husbandry.breed(this.bot, species, pairs, isCancelled, scope))
  }

  /** @this {import('./shared').Worker} */
  async shearSheep(count, isCancelled) {
    return husbandry.shearSheep(this.bot, count, isCancelled, {
      storage: this.storage,
      production: this.production
    })
  }

  /** @this {import('./shared').Worker} */
  async collectAnimalProduct(product, count, isCancelled) {
    const normalized = animalProducts.normalizeProduct(product)
    if (!normalized) throw new Error(`produto animal desconhecido: ${product}`)

    if (normalized === 'wool') {
      const pen = this.penContext('sheep')
      if (!pen?.status?.built) return { ok: false, product: normalized, reason: 'curral_incompleto' }
      const shears = await husbandry.ensureShears(this.bot, { storage: this.storage, production: this.production })
      if (!shears) return { ok: false, product: normalized, reason: 'sem_tesoura' }
      const result = await this.withAnimalPen(pen, isCancelled, () =>
        husbandry.shearSheep(this.bot, count, isCancelled, this.penScope(pen))
      )
      const deposited = this.storage?.configured()
        ? await this.storage.depositCargo(this.bot).catch(() => ({}))
        : {}
      return { ...result, product: normalized, deposited }
    }

    if (normalized === 'milk') {
      const pen = this.penContext('cow')
      if (!pen?.status?.built) return { ok: false, product: normalized, reason: 'curral_incompleto' }
      const available = await animalProducts.ensureBuckets(this.bot, count, { storage: this.storage, production: this.production })
      if (available <= 0) return { ok: false, product: normalized, reason: 'sem_baldes' }
      const result = await this.withAnimalPen(pen, isCancelled, () =>
        animalProducts.milkCows(this.bot, count, isCancelled, this.penScope(pen))
      )
      const deposited = this.storage?.configured()
        ? await this.storage.depositCargo(this.bot).catch(() => ({}))
        : {}
      return { ...result, product: normalized, deposited }
    }

    if (normalized === 'eggs') {
      const pen = this.penContext('chicken')
      if (!pen?.status?.built) return { ok: false, product: normalized, reason: 'curral_incompleto' }
      const center = new Vec3(pen.plan.center.x, pen.plan.center.y, pen.plan.center.z)
      const result = await this.withAnimalPen(pen, isCancelled, () =>
        animalProducts.collectEggs(this.bot, center, isCancelled)
      )
      const deposited = this.storage?.configured()
        ? await this.storage.depositCargo(this.bot).catch(() => ({}))
        : {}
      return { ...result, product: normalized, deposited }
    }

    throw new Error(`produto animal sem executor: ${normalized}`)
  }

  /** @this {import('./shared').Worker} */
  async manageAnimalPopulation(species, target, isCancelled) {
    const pen = this.penContext(species)
    if (!pen?.status?.built) {
      const result = await husbandry.managePopulation(this.bot, species, target, isCancelled, {
        storage: this.storage
      })
      return { ...result, penScoped: false }
    }

    const scope = this.penScope(pen)
    const animals = husbandry.selectAnimals(this.bot, pen.canonical, scope)
    const breedable = animals.filter((entity) => husbandry.canBreed(this.bot, entity))
    const plan = husbandry.populationPlan(animals.length, target, breedable.length)
    const feed = plan.pairs > 0 ? await this.penFeed(pen.canonical, plan.pairs * 2) : null
    if (!feed) {
      // Meta atingida, poucos adultos ou sem ração: responde sem entrar no curral.
      const result = await husbandry.managePopulation(this.bot, species, target, isCancelled, scope)
      return { ...result, penScoped: true }
    }

    const result = await this.withAnimalPen(pen, isCancelled, () =>
      husbandry.managePopulation(this.bot, species, target, isCancelled, scope))
    return { ...result, penScoped: true }
  }

  /** @this {import('./shared').Worker} */
  async ensurePenKit(plan) {
    const woods = [
      'oak', 'spruce', 'birch', 'jungle', 'acacia',
      'dark_oak', 'mangrove', 'cherry', 'bamboo'
    ]

    for (const wood of woods) {
      const fence = `${wood}_fence`
      const gate = `${wood}_fence_gate`
      if (!this.bot.registry?.itemsByName?.[fence] || !this.bot.registry?.itemsByName?.[gate]) continue

      const haveFence = await this.ensureItemAmount(fence, plan.fenceCount)
      const haveGate = await this.ensureItemAmount(gate, plan.gateCount)
      if (haveFence >= plan.fenceCount && haveGate >= plan.gateCount) {
        return { fence, gate }
      }
    }
    return null
  }

  /** @this {import('./shared').Worker} */
  async placeGroundItem(position, itemName, isCancelled) {
    if (isCancelled()) return false
    const pos = new Vec3(position.x, position.y, position.z)
    let current = this.bot.blockAt(pos)
    if (current?.name === itemName) return true

    // Terreno 1 bloco acima do chão do curral (grama, terra...) ocupa a linha da
    // cerca: cava para a cerca ficar no nível das outras (visto no 1.20.1: 18/23).
    if (current && NATURAL_TERRAIN.test(current.name)) {
      await this.goTo(new goals.GoalNear(pos.x, pos.y, pos.z, 3), 10000).catch(() => {})
      if (isCancelled()) return false
      await this.bot.dig(current).catch(() => {})
      current = this.bot.blockAt(pos)
    }
    if (current && current.name !== 'air' && current.boundingBox !== 'empty') return false
    if (current && current.name !== 'air' && current.boundingBox === 'empty') {
      await this.bot.dig(current).catch(() => {})
      current = this.bot.blockAt(pos)
      if (current && current.name !== 'air' && current.boundingBox !== 'empty') return false
    }

    const below = this.bot.blockAt(pos.offset(0, -1, 0))
    if (!below || below.name === 'air' || below.boundingBox === 'empty') return false

    const item = this.bot.inventory.items().find((entry) => entry.name === itemName)
    if (!item) return false

    await this.goTo(new goals.GoalNear(pos.x, pos.y, pos.z, 3), 10000).catch(() => {})
    if (isCancelled()) return false
    await this.bot.equip(item, 'hand').catch(() => {})
    try {
      await this.bot.placeBlock(below, new Vec3(0, 1, 0))
      return this.bot.blockAt(pos)?.name === itemName
    } catch {
      return false
    }
  }

  // O portão fica virado para onde o bot olha ao colocá-lo. O portão fica na
  // parede norte: precisa estar virado norte/sul, senão fica atravessado e deixa
  // fresta. Coloca estando em plan.outside, olhando para o curral, e confere.
  /** @this {import('./shared').Worker} */
  async placePenGate(plan, itemName, isCancelled) {
    const pos = new Vec3(plan.gate.x, plan.gate.y, plan.gate.z)
    const facing = (block) => block?.getProperties?.().facing
    const aligned = (block) => {
      const value = facing(block)
      return value === undefined || value === 'north' || value === 'south'
    }

    for (let attempt = 0; attempt < 2 && !isCancelled(); attempt++) {
      const current = this.bot.blockAt(pos)
      if (current?.name?.endsWith('_fence_gate')) {
        if (aligned(current)) return true
        // Virado de lado: tira para recolocar.
        await this.goTo(new goals.GoalNear(pos.x, pos.y, pos.z, 3), 10000).catch(() => {})
        if (isCancelled()) return false
        await this.bot.dig(current).catch(() => {})
      }

      const out = plan.outside
      await this.goTo(new goals.GoalBlock(out.x, out.y, out.z), 10000).catch(() => {})
      if (isCancelled()) return false
      await this.bot.lookAt?.(pos.offset(0.5, 0.5, 0.5), true)?.catch?.(() => {})
      if (!(await this.placeGroundItem(pos, itemName, isCancelled))) return false
      if (aligned(this.bot.blockAt(pos))) return true
    }
    return false
  }

  // Nivela o interior: um bloco na altura da cerca, encostado nela, vira degrau
  // e os animais pulavam para fora com o portão fechado.
  /** @this {import('./shared').Worker} */
  async levelPenInterior(plan, isCancelled) {
    let leveled = 0
    for (let dx = 1; dx < plan.size - 1 && !isCancelled(); dx++) {
      for (let dz = 1; dz < plan.size - 1 && !isCancelled(); dz++) {
        const block = this.bot.blockAt(new Vec3(plan.origin.x + dx, plan.origin.y, plan.origin.z + dz))
        if (!block || block.boundingBox !== 'block') continue
        await this.goTo(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 3), 8000).catch(() => {})
        if (await this.bot.dig(block).then(() => true, () => false)) leveled++
      }
    }
    return leveled
  }

  /** @this {import('./shared').Worker} */
  async buildAnimalPen(isCancelled, species = 'cow', offset = null) {
    const home = this.homeProvider?.()
    const canonical = husbandry.normalizeSpecies(species) || species
    const plan = groundedPenPlan(this.bot, home, canonical, offset)
    const kit = await this.ensurePenKit(plan)
    if (!kit) throw new Error('não consegui obter cercas e portão suficientes para o curral')

    let leveled = await this.levelPenInterior(plan, isCancelled)

    let fencesPlaced = 0
    for (const position of plan.fences) {
      if (isCancelled()) break
      if (await this.placeGroundItem(position, kit.fence, isCancelled)) fencesPlaced++
    }
    // De novo antes do portão: o pathfinder pode ter posto terra lá dentro durante a obra.
    leveled += await this.levelPenInterior(plan, isCancelled)

    // Acesso ao portão no nível do curral: com a célula da frente 1 bloco mais
    // alta o fazendeiro não conseguia entrar e o portão ficava aberto até o
    // tempo acabar, soltando os animais (visto no 1.20.1).
    const approach = new Vec3(plan.gate.x, plan.gate.y, plan.gate.z - 1)
    for (const pos of [approach, approach.offset(0, 1, 0)]) {
      const block = this.bot.blockAt(pos)
      if (isCancelled() || !NATURAL_TERRAIN.test(block?.name || '')) continue
      await this.goTo(new goals.GoalNear(pos.x, pos.y, pos.z, 3), 8000).catch(() => {})
      await this.bot.dig(block).catch(() => {})
    }

    let gatePlaced = false
    if (!isCancelled()) {
      gatePlaced = await this.placePenGate(plan, kit.gate, isCancelled)
    }

    return {
      ok: !isCancelled() && gatePlaced && fencesPlaced >= plan.fenceCount,
      species: canonical,
      size: plan.size,
      fencesPlaced,
      fencesRequested: plan.fenceCount,
      gatePlaced,
      leveled,
      center: plan.center,
      offset: plan.offset,
      fenceItem: kit.fence,
      gateItem: kit.gate
    }
  }

  /** @this {import('./shared').Worker} */
  async enterAnimalPen(plan, isCancelled) {
    await this.bot.unequip?.('hand').catch?.(() => {})
    if (!(await this.setPenGate(plan, true, isCancelled))) return false
    try {
      const entry = plan.insideEntry
      await this.goTo(new goals.GoalNear(entry.x, entry.y, entry.z, 1), 12000)
    } finally {
      // Cancelado: outra tarefa já controla o pathfinder e fecha o portão ela mesma.
      if (!isCancelled()) await this.setPenGate(plan, false, isCancelled).catch(() => {})
    }
    return !isCancelled() && pointInsidePen(this.bot.entity?.position, plan)
  }

  /** @this {import('./shared').Worker} */
  async withAnimalPen(pen, isCancelled, work) {
    this.useMoves(this.penMoves)
    try {
      const entered = await this.enterAnimalPen(pen.plan, isCancelled)
      if (!entered) throw new Error(`não consegui entrar no curral de ${pen.canonical}`)
      return await work()
    } finally {
      // Se outra tarefa assumiu (cancelamento/defesa) não mexe no pathfinder nem
      // no portão: o run() da próxima tarefa sai do curral pelo portão.
      if (!isCancelled()) {
        if (this.bot.entity && pointInsidePen(this.bot.entity.position, pen.plan)) {
          await this.leaveAnimalPen(pen.plan, isCancelled).catch(() => {})
        } else {
          await this.setPenGate(pen.plan, false, isCancelled).catch(() => {})
        }
        this.useMoves(this.workMoves)
      }
    }
  }

  /** @this {import('./shared').Worker} */
  async waitUntil(check, isCancelled, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    while (!isCancelled()) {
      if (check()) return true
      if (Date.now() >= deadline) return false
      await sleep(this.lure.pollMs)
    }
    return false
  }

  /** @this {import('./shared').Worker} */
  lureDistance(entity) {
    return entity.position.distanceTo(this.bot.entity.position)
  }

  // Espera o animal atraído chegar perto antes de começar a andar.
  /** @this {import('./shared').Worker} */
  async waitForAnimal(entity, isCancelled) {
    return this.waitUntil(
      () => entity.isValid !== false && this.lureDistance(entity) <= this.lure.near,
      isCancelled,
      this.lure.waitMs
    )
  }

  // Anda em trechos curtos até `target` com o animal atrás: se ele ficar a mais
  // de `near` blocos, para e espera ele alcançar. Animal atraído perde o
  // interesse a mais de ~10 blocos, e aí não há o que fazer.
  /** @this {import('./shared').Worker} */
  async leadAnimal(entity, target, isCancelled) {
    const goal = new goals.GoalNear(target.x, target.y, target.z, 1)
    const deadline = Date.now() + this.lure.timeoutMs
    let walking = false
    let waitingSince = null
    try {
      while (!isCancelled() && Date.now() < deadline) {
        if (entity.isValid === false) return false
        const lag = this.lureDistance(entity)
        if (lag > this.lure.lost) return false
        if (lag > this.lure.near) {
          if (walking) this.bot.pathfinder.setGoal(null)
          walking = false
          waitingSince = waitingSince || Date.now()
          if (Date.now() - waitingSince > this.lure.waitMs) return false
        } else {
          waitingSince = null
          if (goal.isEnd(this.bot.entity.position.floored())) return true
          if (!walking) this.bot.pathfinder.setGoal(goal)
          walking = true
        }
        await sleep(this.lure.pollMs)
      }
      return false
    } finally {
      if (walking && !isCancelled()) this.bot.pathfinder.setGoal(null)
    }
  }

  /** @this {import('./shared').Worker} */
  async lureFeed(species) {
    const canonical = husbandry.normalizeSpecies(species) || species
    const config = husbandry.SPECIES[canonical]
    if (!config) throw new Error(`animal não suportado: ${species}`)

    let item = this.bot.inventory.items().find((entry) => config.feed.includes(entry.name))
    if (item) return item

    if (this.storage?.configured()) {
      for (const name of config.feed) {
        const amount = await this.storage.withdraw(this.bot, name, 1).catch(() => 0)
        if (amount > 0) {
          item = this.bot.inventory.items().find((entry) => entry.name === name)
          if (item) return item
        }
      }
    }
    return null
  }

  /** @this {import('./shared').Worker} */
  async setPenGate(plan, open, isCancelled = () => false) {
    const position = new Vec3(plan.gate.x, plan.gate.y, plan.gate.z)
    let gate = this.bot.blockAt(position)
    if (!gate?.name?.endsWith('_fence_gate')) throw new Error('portão do curral não encontrado')

    const current = gate.getProperties?.().open
    if (typeof current === 'boolean' && current === open) {
      this.trackPen(plan, open)
      return true
    }

    await this.goTo(new goals.GoalNear(position.x, position.y, position.z, 3), 10000)
    if (isCancelled()) return false
    await this.bot.activateBlock(gate)
    await sleep(350)
    gate = this.bot.blockAt(position)
    const updated = gate?.getProperties?.().open
    const ok = typeof updated === 'boolean' ? updated === open : true
    if (ok) this.trackPen(plan, open)
    return ok
  }

  // Lembra do curral enquanto o portão está aberto ou o bot está dentro, para
  // a próxima tarefa sair/fechar se esta for cancelada no meio.
  /** @this {import('./shared').Worker} */
  trackPen(plan, open) {
    if (open || pointInsidePen(this.bot.entity?.position, plan)) this.activePen = plan
    else if (this.activePen === plan) this.activePen = null
  }

  /** @this {import('./shared').Worker} */
  async leaveAnimalPen(plan, isCancelled) {
    await this.bot.unequip?.('hand').catch?.(() => {})
    // Os animais acabaram de seguir o fazendeiro e ficam colados nele: abrir o
    // portão na hora deixava um escapar. Espera se afastarem do portão.
    const gateCenter = new Vec3(plan.gate.x + 0.5, plan.gate.y, plan.gate.z + 0.5)
    await this.waitUntil(() => !Object.values(this.bot.entities || {}).some((entity) =>
      entity.name === plan.species && entity.position?.distanceTo(gateCenter) < 2.5
    ), isCancelled, 6000)
    if (!(await this.setPenGate(plan, true, isCancelled))) return false
    try {
      const out = plan.outside
      await this.goTo(new goals.GoalNear(out.x, out.y, out.z, 1), 12000)
      return !isCancelled()
    } finally {
      if (!isCancelled()) await this.setPenGate(plan, false, isCancelled).catch(() => {})
    }
  }

  /** @this {import('./shared').Worker} */
  async captureAnimals(species, count, isCancelled) {
    const pen = this.penContext(species)
    if (!pen) throw new Error('base da colônia ainda não definida')
    if (!pen.status.built) {
      throw new Error(`curral de ${pen.canonical} incompleto: ${pen.status.fencesPresent}/${pen.status.fencesExpected} cercas, portão=${pen.status.gatePresent ? 'ok' : 'ausente'}`)
    }

    const wanted = Math.max(1, Math.min(16, Number.parseInt(count, 10) || 1))
    const feed = await this.lureFeed(pen.canonical)
    if (!feed) {
      return {
        ok: false,
        species: pen.canonical,
        requested: wanted,
        captured: 0,
        reason: 'sem_alimento',
        feed: husbandry.SPECIES[pen.canonical].feed
      }
    }

    const center = new Vec3(pen.plan.center.x, pen.plan.center.y, pen.plan.center.z)
    const candidates = husbandry.selectAnimals(this.bot, pen.canonical, {
      center,
      range: 40,
      filter: (entity) => !pointInsidePen(entity.position, pen.plan)
    })

    let captured = 0
    let attempted = 0
    // Atraindo: sem correr (o animal fica para trás e perde o interesse) e sem cavar.
    this.useMoves(this.penMoves)
    this.bot.setControlState?.('sprint', false)
    try {
      for (const entity of candidates) {
        if (captured >= wanted || isCancelled()) break
        if (entity.isValid === false) continue
        attempted++

        const currentFeed = this.bot.inventory.items().find((entry) => entry.name === feed.name)
        if (!currentFeed) break
        await this.bot.equip(currentFeed, 'hand').catch(() => {})

        await this.goTo(
          new goals.GoalNear(
            Math.floor(entity.position.x),
            Math.floor(entity.position.y),
            Math.floor(entity.position.z),
            3
          ),
          15000
        ).catch(() => {})
        if (isCancelled() || entity.isValid === false) break
        // Com a ração na mão o animal vem até o bot; sem isso não adianta andar.
        if (!(await this.waitForAnimal(entity, isCancelled))) continue
        if (!(await this.leadAnimal(entity, pen.plan.outside, isCancelled))) continue
        if (isCancelled()) break

        let inside = false
        try {
          // Portão aberto só com o animal colado no bot (e o bot já do lado de fora dele).
          if (!(await this.setPenGate(pen.plan, true, isCancelled))) continue
          if (isCancelled()) break

          await this.bot.equip(currentFeed, 'hand').catch(() => {})
          // Vai até o centro para puxar o animal inteiro para dentro antes de fechar.
          await this.leadAnimal(entity, pen.plan.center, isCancelled)
          inside = await this.waitUntil(
            () => entity.isValid !== false && pointInsidePen(entity.position, pen.plan),
            isCancelled,
            1500
          )
        } finally {
          if (!isCancelled()) await this.setPenGate(pen.plan, false, isCancelled).catch(() => {})
        }

        if (inside) captured++
        if (!isCancelled()) await this.leaveAnimalPen(pen.plan, isCancelled).catch(() => {})
      }
    } finally {
      if (!isCancelled()) this.useMoves(this.workMoves)
    }

    const insideNow = husbandry.selectAnimals(this.bot, pen.canonical, {
      center,
      range: pen.plan.size + 2,
      filter: (entity) => pointInsidePen(entity.position, pen.plan)
    }).length

    return {
      ok: captured >= wanted,
      species: pen.canonical,
      requested: wanted,
      attempted,
      captured,
      inside: insideNow,
      feed: feed.name
    }
  }

  /** @this {import('./shared').Worker} */
  useMoves(moves) {
    if (moves && typeof this.bot.pathfinder?.setMovements === 'function') this.bot.pathfinder.setMovements(moves)
  }

  // Curral construído (com portão) que contém a posição, entre os das espécies conhecidas.
  /** @this {import('./shared').Worker} */
  penAt(position) {
    const home = this.homeProvider?.()
    if (!home || !position) return null
    for (const species of Object.keys(SPECIES_OFFSETS)) {
      const plan = groundedPenPlan(this.bot, home, species)
      if (pointInsidePen(position, plan) && inspectAnimalPen(this.bot, plan).gatePresent) return plan
    }
    return null
  }

  // Uma tarefa cancelada no meio do manejo pode deixar o bot dentro do curral
  // ou o portão aberto: sai pelo portão (abrir → sair → fechar) antes de seguir,
  // senão o pathfinder tentaria atravessar a cerca.
  /** @this {import('./shared').Worker} */
  async leaveLeftoverPen(isCancelled) {
    const plan = this.activePen || this.penAt(this.bot.entity?.position)
    if (!plan) return
    this.useMoves(this.penMoves)
    try {
      if (this.bot.entity && pointInsidePen(this.bot.entity.position, plan)) {
        await this.leaveAnimalPen(plan, isCancelled)
      } else {
        await this.setPenGate(plan, false, isCancelled)
      }
    } catch (err) {
      this.logger.log(`[colônia] ${this.name} não saiu do curral: ${err.message}`)
    } finally {
      if (!isCancelled()) {
        this.activePen = null
        this.useMoves(this.workMoves)
      }
    }
  }
}

module.exports = { PensBehavior }
