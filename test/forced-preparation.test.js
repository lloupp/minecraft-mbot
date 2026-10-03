const test = require('node:test')
const assert = require('node:assert/strict')
const { preparationPlan, preparationDispatchTask, preparationIntegrationPreflight, preparationIntegrationTask, recoverApprovedCobblestoneDrops, executePreparationStep } = require('../lib/forced-preparation')
const gather = require('../lib/gather')
const food = require('../lib/food')
const { Vec3 } = require('vec3')


test('dispatch policy only creates bounded preparation tasks for eligible deterministic intents', () => {
  const base = {
    health: 20,
    food: 20,
    inventory: {},
    craftable: [],
    equippedWeapon: null,
    nearby: { wood: true, stone: true, iron: false },
    objective: { type: 'explore', completed: false },
    threat: null,
    cancellationRequested: false
  }

  assert.equal(preparationDispatchTask({ enabled: false, state: base, objective: { type: 'explorar' }, allowedTargets: [{ x: 1, y: 64, z: 1, name: 'stone' }] }), null)
  assert.equal(preparationDispatchTask({ enabled: true, state: base, objective: { type: 'explorar' }, allowedTargets: [] }), null)

  const task = preparationDispatchTask({
    enabled: true,
    state: base,
    objective: { type: 'explorar', radius: 16 },
    allowedTargets: [{ x: 1, y: 64, z: 1, name: 'stone' }]
  })
  assert.equal(task.type, 'preparar_combate_deterministico')
  assert.equal(task.deterministicIntent, 'gather_materials')
  assert.equal(task.objective.type, 'explorar')
})

test('dispatch policy refuses preparation when safety or normal progress has precedence', () => {
  const safeBase = {
    health: 20,
    food: 20,
    inventory: {},
    craftable: [],
    equippedWeapon: null,
    nearby: { wood: true, stone: true, iron: false },
    objective: { type: 'explore', completed: false }
  }

  const threat = {
    ...safeBase,
    threat: { type: 'zombie', distance: 3, count: 1 }
  }
  assert.equal(preparationDispatchTask({
    enabled: true,
    state: threat,
    objective: { type: 'explorar' },
    allowedTargets: [{ x: 1, y: 64, z: 1, name: 'stone' }]
  }), null)

  const armed = {
    ...safeBase,
    inventory: { stone_sword: 1 },
    equippedWeapon: 'stone_sword'
  }
  assert.equal(preparationDispatchTask({
    enabled: true,
    state: armed,
    objective: { type: 'explorar' },
    allowedTargets: [{ x: 1, y: 64, z: 1, name: 'stone' }]
  }), null)
})


test('integration preflight requires live table, mining tool and enough live approved targets', () => {
  const position = new Vec3(0, 64, 0)
  const tablePosition = new Vec3(-1, 64, 0)
  const stones = [new Vec3(1, 64, 0), new Vec3(0, 64, 1)]
  const state = {
    health: 20,
    food: 20,
    inventory: { stick: 1, stone_pickaxe: 1 },
    craftable: [],
    equippedWeapon: null,
    nearby: { wood: false, stone: true, iron: false },
    objective: { type: 'explore', completed: false },
    threat: null,
    cancellationRequested: false
  }
  const items = [{ name: 'stick', count: 1 }, { name: 'stone_pickaxe', count: 1 }]
  const bot = {
    entity: { position },
    inventory: { items: () => items },
    registry: {
      blocksArray: [{ id: 1, name: 'stone', drops: [2] }],
      blocksByName: { stone: { id: 1, name: 'stone', drops: [2] }, crafting_table: { id: 3, name: 'crafting_table' } },
      items: { 2: { name: 'cobblestone' } }
    },
    blockAt: p => {
      if (p.equals(tablePosition)) return { name: 'crafting_table', position: p }
      if (stones.some(s => s.equals(p))) return { name: 'stone', position: p }
      return { name: 'air', position: p }
    },
    canDigBlock: () => true,
    canSeeBlock: () => true,
    pathfinder: { bestHarvestTool: () => items[1] }
  }
  const production = { cachedCraftingTable: () => ({ position: tablePosition }) }
  const allowedTargets = stones.map(p => ({ x: p.x, y: p.y, z: p.z, name: 'stone' }))

  const ready = preparationIntegrationPreflight({ bot, production, state, allowedTargets })
  assert.equal(ready.ok, true)
  assert.equal(ready.choice, 'gather_materials')
  assert.equal(ready.requiredTargets, 2)

  const task = preparationIntegrationTask({
    enabled: true,
    bot,
    production,
    state,
    objective: { type: 'explorar' },
    allowedTargets
  })
  assert.equal(task.type, 'preparar_combate_deterministico')
  assert.equal(task.integrationPreflight.choice, 'gather_materials')

  production.cachedCraftingTable = () => null
  assert.equal(preparationIntegrationTask({
    enabled: true, bot, production, state, objective: { type: 'explorar' }, allowedTargets
  }), null)

  production.cachedCraftingTable = () => ({ position: tablePosition })
  items.splice(1, 1)
  assert.equal(preparationIntegrationTask({
    enabled: true, bot, production, state, objective: { type: 'explorar' }, allowedTargets
  }), null)
})

test('integration preflight refuses physically unusable approved targets before task creation', () => {
  const position = new Vec3(0, 64, 0)
  const tablePosition = new Vec3(-1, 64, 0)
  const nearStone = new Vec3(1, 64, 0)
  const farStone = new Vec3(8, 64, 0)
  const pickaxe = { name: 'stone_pickaxe', count: 1 }
  const state = {
    health: 20,
    food: 20,
    inventory: { stick: 1, stone_pickaxe: 1 },
    craftable: [],
    equippedWeapon: null,
    nearby: { stone: true },
    objective: { type: 'explore', completed: false }
  }
  const bot = {
    entity: { position },
    inventory: { items: () => [pickaxe] },
    registry: {
      blocksArray: [{ id: 1, name: 'stone', drops: [2] }],
      blocksByName: { stone: { id: 1, name: 'stone', drops: [2] } },
      items: { 2: { name: 'cobblestone' } }
    },
    blockAt: p => {
      if (p.equals(tablePosition)) return { name: 'crafting_table', position: p }
      if (p.equals(nearStone) || p.equals(farStone)) return { name: 'stone', position: p }
      return { name: 'air', position: p }
    },
    canDigBlock: block => !block.position.equals(nearStone),
    canSeeBlock: () => true,
    pathfinder: { bestHarvestTool: () => pickaxe }
  }
  const production = { cachedCraftingTable: () => ({ position: tablePosition }) }
  const preflight = preparationIntegrationPreflight({
    bot,
    production,
    state,
    allowedTargets: [
      { x: nearStone.x, y: nearStone.y, z: nearStone.z, name: 'stone' },
      { x: farStone.x, y: farStone.y, z: farStone.z, name: 'stone' }
    ]
  })
  assert.equal(preflight.ok, false)
  assert.equal(preflight.code, 'APPROVED_TARGETS_INSUFFICIENT')
})

test('integration preflight allows carried stone sword without requiring a crafting table', () => {
  const state = {
    health: 20,
    food: 20,
    inventory: { stone_sword: 1 },
    craftable: [],
    equippedWeapon: null,
    nearby: {},
    objective: { type: 'explore', completed: false }
  }
  const bot = { entity: { position: new Vec3(0, 64, 0) } }
  const preflight = preparationIntegrationPreflight({ bot, production: {}, state })
  assert.equal(preflight.ok, true)
  assert.equal(preflight.choice, 'equip_best_weapon')
  assert.equal(preflight.tableRequired, false)
})

test('planner collects exactly the missing recipe inputs, accounting for conversion batches', () => {
  assert.deepEqual(preparationPlan({ inventory: { stick: 1 } }).collect, { logs: 0, cobblestone: 2 })
  assert.deepEqual(preparationPlan({ inventory: { cobblestone: 2 } }).collect, { logs: 1, cobblestone: 0 })
  assert.deepEqual(preparationPlan({ inventory: { oak_planks: 2, cobblestone: 1 } }).collect, { logs: 0, cobblestone: 1 })
  assert.deepEqual(preparationPlan({ inventory: { oak_log: 1, cobblestone: 2 } }).collect, { logs: 0, cobblestone: 0 })
  assert.deepEqual(preparationPlan({ inventory: { stick: 1, cobblestone: 1 } }).collect, { logs: 0, cobblestone: 1 })
})

test('bridge has no effect unless explicitly enabled', async () => {
  const bot = new Proxy({}, { get() { throw new Error('bot should not be touched') } })
  assert.deepEqual(await executePreparationStep({ bot }), { ok: false, code: 'DISABLED' })
})

function unarmedBot() {
  const position = new Vec3(0, 64, 0)
  return { health: 20, food: 20, time: { timeOfDay: 1000 }, entity: { position },
    entities: {}, nearestEntity: () => null, inventory: { items: () => [], slots: [] },
    blockAt: p => ({ name: p.y === 64 && p.x === -2 && p.z === 0 ? 'oak_log'
      : p.y === 64 && (p.x === 2 && p.z === 0 || p.x === 0 && p.z === 2) ? 'stone' : 'air', position: p }) }
}

test('preflight refuses missing table and unauthorized material sources before digging', async () => {
  const bot = unarmedBot()
  bot.dig = () => { throw new Error('must not dig') }
  const args = { enabled: true, bot, task: { type: 'explorar' }, production: { cachedCraftingTable: () => null } }
  assert.equal((await executePreparationStep(args)).code, 'NEARBY_TABLE_REQUIRED')
  args.production.cachedCraftingTable = () => ({ position: new Vec3(1, 64, 1) })
  assert.equal((await executePreparationStep(args)).code, 'APPROVED_TARGETS_INSUFFICIENT')
  args.allowedTargets = [{ x: -2, y: 64, z: 0, name: 'oak_log' }, { x: 2, y: 64, z: 0, name: 'stone' }, { x: 0, y: 64, z: 2, name: 'stone' }]
  assert.equal((await executePreparationStep(args)).code, 'MINING_PICKAXE_REQUIRED')
  args.allowedTargets[2] = args.allowedTargets[1]
  assert.equal((await executePreparationStep(args)).code, 'APPROVED_TARGETS_INSUFFICIENT')
  // Storage configurado não bloqueia mais o caminho local-only: a recusa continua sendo a física.
  args.production.storage = { configured: () => true }
  assert.equal((await executePreparationStep(args)).code, 'APPROVED_TARGETS_INSUFFICIENT')
})

test('cancel and critical food preempt physical preparation', async () => {
  const bot = unarmedBot()
  const cancelled = await executePreparationStep({ enabled: true, bot, task: { type: 'explorar' }, isCancelled: () => true })
  assert.equal(cancelled.code, 'CANCELLED')
  assert.equal(cancelled.interrupted, true)

  bot.food = 5
  bot.entities = { cow: { name: 'cow', position: new Vec3(1, 64, 0) } }
  const hungry = await executePreparationStep({ enabled: true, bot, task: { type: 'explorar' }, homeProvider: () => new Vec3(100, 64, 0) })
  assert.equal(hungry.code, 'SAFETY_FIND_FOOD')
  assert.equal(hungry.interrupted, true)
})

test('authorized gathering never selects a closer unapproved block', async () => {
  const unapproved = new Vec3(1, 64, 0), approved = new Vec3(2, 64, 0)
  let present = true
  const items = [], dug = []
  const bot = {
    registry: { blocksArray: [{ id: 1, name: 'oak_log' }] }, inventory: { items: () => items }, entities: {},
    findBlocks: () => present ? [unapproved, approved] : [unapproved],
    blockAt: p => ({ name: p.y === 64 && p.z === 0 && (p.x === 1 || p.x === 2) ? 'oak_log' : 'air', position: p }),
    pathfinder: { goto: async () => {}, bestHarvestTool: () => null },
    equip: async () => {}, dig: async block => { dug.push(block.position); present = false; items.push({ name: 'oak_log', count: 1 }) }
  }
  const n = await gather.mineBlocks(bot, n => n === 'oak_log', 1, () => false, { allowedPositions: new Set([approved.toString()]) })
  assert.equal(n, 1)
  assert.deepEqual(dug, [approved])
})

test('visible approved block in physical reach does not require a navigation goal', async () => {
  const pos = new Vec3(2, 64, 0), items = []
  const bot = {
    registry: { blocksArray: [{ id: 1, name: 'oak_log' }] }, inventory: { items: () => items }, entities: {},
    findBlocks: () => [pos], blockAt: p => ({ name: p.equals(pos) ? 'oak_log' : 'air', position: p }),
    canDigBlock: () => true, lookAt: async () => {}, blockAtCursor: () => ({ position: pos }),
    pathfinder: { goto: () => { throw new Error('should not navigate') }, bestHarvestTool: () => null },
    dig: async () => items.push({ name: 'oak_log', count: 1 })
  }
  const attempts = []
  assert.equal(await gather.mineBlocks(bot, n => n === 'oak_log', 1, () => false,
    { allowedPositions: new Set([pos.toString()]), preferInReach: true, onAttempt: a => attempts.push(a) }), 1)
  assert.equal(attempts[0].navigation, 'visible_in_reach')
})

test('carried sword cancels material plan and can be equipped without crafting again', async () => {
  const bot = unarmedBot()
  bot.inventory.items = () => [{ name: 'stone_sword', count: 1 }]
  bot.equip = async item => { bot.heldItem = item }
  assert.deepEqual(preparationPlan({ inventory: { stone_sword: 1 } }).collect, { logs: 0, cobblestone: 0 })
  const result = await executePreparationStep({ enabled: true, bot, task: { type: 'explorar' }, production: {} })
  assert.equal(result.ok, true)
  assert.equal(result.intent, 'equip_best_weapon')
  assert.deepEqual(result.steps.map(s => s.task), ['equip'])
  assert.deepEqual(result.nextCandidates.map(c => c.id), ['continue_objective'])
})

test('opt-in collection refuses blocked target then uses only a visible approved alternative', async () => {
  const blocked = new Vec3(1, 64, 0), approved = new Vec3(2, 64, 0), items = [], dug = []
  let looking
  const bot = {
    registry: { blocksArray: [{ id: 1, name: 'oak_log' }] }, inventory: { items: () => items }, entities: {},
    findBlocks: () => [blocked, approved], blockAt: p => ({ name: p.equals(blocked) || p.equals(approved) ? 'oak_log' : 'air', position: p }),
    canDigBlock: () => true, lookAt: async p => { looking = p },
    blockAtCursor: () => ({ position: looking.x === 2.5 ? approved : new Vec3(0, 64, 0) }),
    pathfinder: { goto: () => assert.fail('blocked target must not navigate'), bestHarvestTool: () => null },
    dig: async block => { dug.push(block.position); items.push({ name: 'oak_log', count: 1 }) }
  }
  const attempts = []
  assert.equal(await gather.mineBlocks(bot, n => n === 'oak_log', 1, () => false,
    { allowedPositions: new Set([blocked.toString(), approved.toString()]), requireInReach: true, onAttempt: a => attempts.push(a) }), 1)
  assert.equal(attempts[0].code, 'TARGET_BLOCKED')
  assert.equal(attempts[1].itemConfirmed, true)
  assert.deepEqual(dug, [approved])
})

test('in-flight craft inventory is recorded on cancellation and resume only equips the produced sword', async () => {
  const bot = unarmedBot(), items = [{ name: 'stick', count: 1 }, { name: 'cobblestone', count: 2 }]
  bot.inventory.items = () => items
  let cancelled = false
  bot.equip = async () => assert.fail('cancelled craft must not start equip')
  const production = {
    cachedCraftingTable: () => ({ position: new Vec3(1, 64, 1) }),
    craftInternal: async () => { items.splice(0, items.length, { name: 'stone_sword', count: 1 }); cancelled = true; return { produced: 1 } }
  }
  const result = await executePreparationStep({ enabled: true, bot, task: { type: 'explorar' }, production, isCancelled: () => cancelled })
  assert.equal(result.code, 'CANCELLED')
  assert.equal(result.steps[0].inventoryConfirmed, true)
  assert.equal(result.steps[0].interruption, 'CANCELLED')
  assert.equal(result.final.inventory.stone_sword, 1)
  assert.deepEqual(result.remainingPlan.collect, { logs: 0, cobblestone: 0 })
})

test('live approved remaining source refines sparse perception and collects only the missing cobblestone', async () => {
  const bot = unarmedBot(), items = [{ name:'stick', count:1 }, { name:'cobblestone', count:1 }, { name:'stone_pickaxe', count:1 }]
  const target = new Vec3(1, 64, 1)
  let present = true
  bot.inventory.items = () => items
  bot.blockAt = p => ({ name: present && p.equals(target) ? 'stone' : 'air', position:p })
  bot.registry = { blocksByName:{ stone:{ drops:[1] } }, items:{ 1:{ name:'cobblestone' } } }
  bot.pathfinder = { bestHarvestTool: () => items[2] }
  const original = gather.mineBlocks
  gather.mineBlocks = async (_, predicate, quantity, cancelled, options) => {
    assert.equal(quantity,1); assert.equal(options.requireInReach,true)
    assert.deepEqual([...options.allowedPositions],[target.toString()]); assert.equal(cancelled(),false)
    items[1].count++; present = false; options.onAttempt({ delta:1, itemConfirmed:true }); return 1
  }
  try {
    const result = await executePreparationStep({ enabled:true, bot, task:{ type:'explorar' },
      production:{ cachedCraftingTable: () => ({ position:new Vec3(-1,64,-1) }) }, allowedTargets:[{ x:1,y:64,z:1,name:'stone' }] })
    assert.equal(result.ok,true)
    assert.equal(result.steps[0].requested,1)
    assert.equal(result.final.inventory.cobblestone,2)
    assert(!result.nextCandidates.some(c => c.id === 'gather_materials'))
  } finally { gather.mineBlocks = original }
})

test('gather step is confirmed by the inventory gain even when mineBlocks counted fewer items', async () => {
  const bot = unarmedBot(), items = [{ name:'stick', count:1 }, { name:'cobblestone', count:1 }, { name:'stone_pickaxe', count:1 }]
  const target = new Vec3(1, 64, 1)
  bot.inventory.items = () => items
  bot.blockAt = p => ({ name: p.equals(target) ? 'stone' : 'air', position:p })
  bot.registry = { blocksByName:{ stone:{ drops:[1] } }, items:{ 1:{ name:'cobblestone' } } }
  bot.pathfinder = { bestHarvestTool: () => items[2] }
  const original = gather.mineBlocks
  // Um drop pego tarde chega ao inventário, mas o contador do mineBlocks não o conta.
  gather.mineBlocks = async (_, __, ___, ____, options) => {
    assert.equal(options.retryPickup, true)
    items[1].count++; options.onAttempt({ code:'TARGET_BLOCKED' }); return 0
  }
  try {
    const result = await executePreparationStep({ enabled:true, bot, task:{ type:'explorar' },
      production:{ cachedCraftingTable: () => ({ position:new Vec3(-1,64,-1) }) }, allowedTargets:[{ x:1,y:64,z:1,name:'stone' }] })
    assert.equal(result.ok,true)
    assert.equal(result.steps[0].collected,0)
    assert.equal(result.steps[0].gained,1)
    assert.equal(result.steps[0].inventoryConfirmed,true)
  } finally { gather.mineBlocks = original }
})

test('gather returns once to the validated anchor when pickups drifted the bot away from the table', async () => {
  const bot = unarmedBot(), items = [{ name:'stick', count:1 }, { name:'cobblestone', count:1 }, { name:'stone_pickaxe', count:1 }]
  const target = new Vec3(1, 64, 1)
  bot.inventory.items = () => items
  bot.blockAt = p => ({ name: p.equals(target) ? 'stone' : 'air', position:p })
  bot.registry = { blocksByName:{ stone:{ drops:[1] } }, items:{ 1:{ name:'cobblestone' } } }
  bot.pathfinder = { bestHarvestTool: () => items[2] }
  const originalMine = gather.mineBlocks, originalGoTo = food.goTo
  const moves = []
  gather.mineBlocks = async (_, __, ___, ____, options) => {
    items[1].count++; options.onAttempt({ delta:1, itemConfirmed:true })
    bot.entity.position = new Vec3(6, 64, 0) // deriva do pickup, longe da mesa em (-1,64,-1)
    return 1
  }
  food.goTo = async (_bot, goal) => { moves.push([goal.x, goal.y, goal.z]); bot.entity.position = new Vec3(0, 64, 0) }
  try {
    const result = await executePreparationStep({ enabled:true, bot, task:{ type:'explorar' },
      production:{ cachedCraftingTable: () => ({ position:new Vec3(-1,64,-1) }) }, allowedTargets:[{ x:1,y:64,z:1,name:'stone' }] })
    assert.equal(result.ok,true)
    assert.deepEqual(moves,[[0,64,0]])
  } finally { gather.mineBlocks = originalMine; food.goTo = originalGoTo }
})

test('executor approves only usable stone: a source covered by falling sand is not offered to mineBlocks', async () => {
  const bot = unarmedBot(), items = [{ name:'stick', count:1 }, { name:'cobblestone', count:1 }, { name:'stone_pickaxe', count:1 }]
  const covered = new Vec3(1, 64, 1), usable = new Vec3(0, 64, 2), sand = new Vec3(1, 65, 1)
  bot.inventory.items = () => items
  bot.blockAt = p => ({ name: p.equals(covered) || p.equals(usable) ? 'stone' : p.equals(sand) ? 'sand' : 'air', position:p })
  bot.registry = { blocksByName:{ stone:{ drops:[1] } }, items:{ 1:{ name:'cobblestone' } } }
  bot.pathfinder = { bestHarvestTool: () => items[2], setGoal() {} }
  const originalMine = gather.mineBlocks
  let offered = null
  gather.mineBlocks = async (_, __, ___, ____, options) => { offered = [...options.allowedPositions]; items[1].count++; options.onAttempt({ delta:1, itemConfirmed:true }); return 1 }
  try {
    const result = await executePreparationStep({ enabled:true, bot, task:{ type:'explorar' },
      production:{ cachedCraftingTable: () => ({ position:new Vec3(-1,64,-1) }) },
      allowedTargets:[{ x:1,y:64,z:1,name:'stone' }, { x:0,y:64,z:2,name:'stone' }] })
    assert.equal(result.ok, true)
    assert.deepEqual(offered, [usable.toString()])
  } finally { gather.mineBlocks = originalMine }
})

function recipePreparation() {
  const { ProductionManager } = require('../core/ProductionManager')
  const bot = unarmedBot(), pos = new Vec3(-1,64,-1)
  const items = [{ name:'cobblestone', type:1, count:2 },{ name:'stick',type:2,count:1 }]
  let tablePresent = true, crafts = 0
  bot.inventory.items = () => items
  bot.registry = { itemsByName:{stone_sword:{id:3}}, items:{1:{name:'cobblestone'},2:{name:'stick'}} }
  bot.blockAt = p => ({name:tablePresent && p.equals(pos)?'crafting_table':'air',position:p})
  bot.recipesAll = () => [{requiresTable:true,result:{id:3,count:1},delta:[{id:1,count:-2},{id:2,count:-1},{id:3,count:1}]}]
  bot.craft = async () => { crafts++; items.splice(0,items.length,{name:'stone_sword',type:3,count:1}) }
  bot.equip = async item => { bot.heldItem = item }
  bot.nearestEntity = predicate => Object.values(bot.entities).find(predicate) || null
  const pm = new ProductionManager({storage:null}); pm.rememberCraftingTable(bot,bot.blockAt(pos))
  const args = {enabled:true,bot,task:{type:'explorar'},production:pm}
  return {bot,pm,args,items,removeTable:()=>{tablePresent=false},crafts:()=>crafts}
}

test('craft guard rechecks safety after async table lookup and before physical submission', async () => {
  const f=recipePreparation(),ensure=f.pm.ensureCraftingTable.bind(f.pm)
  f.pm.ensureCraftingTable=async(...args)=>{const table=await ensure(...args);f.bot.entities.z={name:'zombie',type:'hostile',position:new Vec3(1,64,0)};return table}
  const result=await executePreparationStep(f.args)
  assert.equal(result.code,'THREAT');assert.equal(f.crafts(),0);assert.equal(result.final.inventory.cobblestone,2)
})

test('table removed after preflight is refused without finding, making or placing another', async () => {
  const f=recipePreparation(),ensure=f.pm.ensureCraftingTable.bind(f.pm)
  f.pm.ensureCraftingTable=async(...args)=>{const table=await ensure(...args);f.removeTable();return table}
  f.bot.findBlock=()=>assert.fail('must not find another table')
  f.bot.placeBlock=()=>assert.fail('must not bootstrap table')
  const result=await executePreparationStep(f.args)
  assert.equal(result.code,'NEARBY_TABLE_REQUIRED');assert.equal(f.crafts(),0)
  assert.equal(f.pm.cachedCraftingTable(f.bot),null)
})

test('local recipe input removed after table preflight gives specific refusal without ingredient recursion', async () => {
  const f=recipePreparation(),ensure=f.pm.ensureCraftingTable.bind(f.pm)
  f.pm.ensureCraftingTable=async(...args)=>{const table=await ensure(...args);f.items[0].count=1;return table}
  const result=await executePreparationStep(f.args)
  assert.equal(result.code,'RECIPE_INPUTS_CHANGED');assert.equal(f.crafts(),0)
  assert.equal(result.remainingPlan.collect.cobblestone,1)
})

test('sword appearing in async preparation window is equipped without crafting a duplicate', async () => {
  const f=recipePreparation(),ensure=f.pm.ensureCraftingTable.bind(f.pm)
  const recipes=f.bot.recipesAll();f.bot.recipesAll=()=>[...recipes,{...recipes[0],delta:[{id:4,count:-2}]}]
  f.pm.ensureCraftingTable=async(...args)=>{const table=await ensure(...args);f.items.push({name:'stone_sword',type:3,count:1});return table}
  const result=await executePreparationStep(f.args)
  assert.equal(result.ok,true);assert.equal(f.crafts(),0)
  assert.equal(f.bot.heldItem.name,'stone_sword');assert.equal(result.final.inventory.stone_sword,1)
  assert.equal(result.steps[0].result.skipped,true)
})

test('safety interruption stays latched if threat disappears before error handling', async () => {
  const f=recipePreparation()
  f.pm.craftInternal=async(_bot,_name,_q,_depth,_trail,execution)=>{
    f.bot.entities.z={name:'zombie',type:'hostile',position:new Vec3(1,64,0)}
    assert.throws(()=>execution.beforeAction({operation:'craft',item:'stone_sword'}),/THREAT/)
    f.bot.entities={}
    execution.beforeAction({operation:'craft',item:'stone_sword'})
  }
  const result=await executePreparationStep(f.args)
  assert.equal(result.code,'THREAT');assert.equal(result.final.threat,null);assert.equal(f.crafts(),0)
})

test('limited dispatch refuses unsupported weapons and any threat, including a carriable sword under threat', () => {
  const base={health:20,food:20,time:'day',inventory:{},equippedWeapon:null,nearby:{wood:false,stone:false},objective:{type:'explore'}}
  const dispatch=state=>preparationDispatchTask({enabled:true,state,objective:{type:'explorar'}})
  assert.equal(dispatch({...base,craftable:['wooden_sword']}),null)
  assert.equal(dispatch({...base,inventory:{iron_sword:1},craftable:[]}),null)
  assert.equal(dispatch({...base,inventory:{stone_sword:1},threat:{type:'zombie',distance:8,count:1}}),null)
  assert.equal(dispatch({...base,inventory:{stone_sword:1,iron_sword:1}}),null)
  assert.equal(dispatch({...base,craftable:['stone_sword'],cancellationRequested:true}),null)
  assert.equal(dispatch({...base,food:5,craftable:['stone_sword'],nearby:{food:true,foodDistance:2},baseKnown:true,baseDistance:50}),null)
})

test('pickaxe lost after partial pickup prevents a second authorized stone dig', async () => {
  const bot=unarmedBot(),positions=[new Vec3(2,64,0),new Vec3(0,64,2)],dug=[]
  const items=[{name:'stick',count:1},{name:'stone_pickaxe',count:1}],alive=new Set(positions.map(p=>p.toString()))
  let looking
  bot.inventory.items=()=>items
  bot.registry={blocksArray:[{id:1,name:'stone',drops:[2]}],items:{2:{name:'cobblestone'}},blocksByName:{stone:{drops:[2]}}}
  bot.findBlocks=()=>positions.filter(p=>alive.has(p.toString()))
  bot.blockAt=p=>({name:alive.has(p.toString())?'stone':'air',position:p})
  bot.canDigBlock=()=>true;bot.lookAt=async p=>{looking=p.offset(-.5,-.5,-.5)};bot.blockAtCursor=()=>({position:looking})
  bot.pathfinder={bestHarvestTool:()=>items.find(i=>i.name==='stone_pickaxe')||null,goto:()=>assert.fail('must not navigate')}
  bot.equip=async()=>{}
  bot.dig=async block=>{dug.push(block.position);alive.delete(block.position.toString());items.splice(1,1,{name:'cobblestone',count:1})}
  const result=await executePreparationStep({enabled:true,bot,task:{type:'explorar'},production:{cachedCraftingTable:()=>({position:new Vec3(-1,64,-1)})},allowedTargets:positions.map(p=>({...p,name:'stone'}))})
  assert.equal(result.code,'MINING_PICKAXE_REQUIRED');assert.equal(dug.length,1)
  assert.equal(result.final.inventory.cobblestone,1);assert.equal(result.remainingPlan.collect.cobblestone,1)
})


test('closing connection after a submitted craft blocks equip before the delayed end event', async () => {
  const f = recipePreparation(), craft = f.pm.craftInternal.bind(f.pm)
  let equips = 0
  f.bot._client = { ended: false, serializer: { writableEnded: false } }
  f.bot.equip = async item => { equips++; f.bot.heldItem = item }
  f.pm.craftInternal = async (...args) => {
    const result = await craft(...args)
    f.bot._client.serializer.writableEnded = true
    return result
  }
  const result = await executePreparationStep(f.args)
  assert.equal(result.code, 'DISCONNECTED')
  assert.equal(result.interrupted, true)
  assert.equal(result.final.inventory.stone_sword, 1)
  assert.equal(result.remainingPlan.collect.cobblestone, 0)
  assert.equal(equips, 0)
  assert.equal(f.crafts(), 1)
  f.bot._client = { ended: false, serializer: { writableEnded: false } }
  const resumed = await executePreparationStep(f.args)
  assert.equal(resumed.ok, true)
  assert.equal(resumed.intent, 'equip_best_weapon')
  assert.equal(equips, 1)
  assert.equal(f.crafts(), 1)
})


test('reconnect recovery credits only an inventory-confirmed cobblestone drop near an approved destroyed target', async () => {
  const target = new Vec3(2, 64, 0)
  let cobblestone = 0
  const drop = {
    name: 'item',
    isValid: true,
    position: new Vec3(2.4, 64, 0.2),
    getDroppedItem: () => ({ name: 'cobblestone' })
  }
  const bot = {
    entities: { drop },
    blockAt: p => ({ name: p.equals(target) ? 'air' : 'air', position: p })
  }
  const original = food.collectDrops
  food.collectDrops = async (_bot, center, cancelled, options) => {
    assert.equal(center.equals(target), true)
    assert.equal(options.radius, 2)
    assert.equal(cancelled(), false)
    cobblestone += 1
  }
  const steps = []
  try {
    const recovered = await recoverApprovedCobblestoneDrops({
      bot,
      allowedTargets: [{ x: 2, y: 64, z: 0, name: 'stone' }],
      maxItems: 2,
      stopped: () => false,
      snapshot: () => ({ inventory: { cobblestone } }),
      check: () => {},
      steps
    })
    assert.equal(recovered, 1)
    assert.equal(steps.length, 1)
    assert.equal(steps[0].inventoryConfirmed, true)
    assert.equal(steps[0].delta, 1)
  } finally {
    food.collectDrops = original
  }
})

test('reconnect recovery refuses ambiguous matching drops near the same destroyed target', async () => {
  const target = new Vec3(2, 64, 0)
  const makeDrop = (x) => ({
    name: 'item',
    isValid: true,
    position: new Vec3(x, 64, 0),
    getDroppedItem: () => ({ name: 'cobblestone' })
  })
  const bot = {
    entities: { a: makeDrop(2.2), b: makeDrop(2.6) },
    blockAt: p => ({ name: p.equals(target) ? 'air' : 'air', position: p })
  }
  const original = food.collectDrops
  food.collectDrops = async () => assert.fail('ambiguous drops must not be collected')
  try {
    const recovered = await recoverApprovedCobblestoneDrops({
      bot,
      allowedTargets: [{ x: 2, y: 64, z: 0, name: 'stone' }],
      maxItems: 2,
      stopped: () => false,
      snapshot: () => ({ inventory: {} }),
      check: () => {}
    })
    assert.equal(recovered, 0)
  } finally {
    food.collectDrops = original
  }
})

test('limited recovery ignores wrong, outside-radius and still-existing-target drops', async () => {
  const center = new Vec3(0, 64, 2)
  const original = food.collectDrops
  food.collectDrops = async () => assert.fail('refused drop must not start movement')
  try {
    for (const sample of [
      { item: 'dirt', distance: 1, block: 'air' },
      { item: 'cobblestone', distance: 2.01, block: 'air' },
      { item: 'cobblestone', distance: 1, block: 'stone' }
    ]) {
      const drop = { name: 'item', isValid: true, position: center.offset(sample.distance,0,0), getDroppedItem: () => ({ name: sample.item }) }
      const steps = []
      const recovered = await recoverApprovedCobblestoneDrops({
        bot: { entities: { drop }, blockAt: () => ({ name: sample.block }) },
        allowedTargets: [{ x:0,y:64,z:2,name:'stone' }], maxItems:2,
        snapshot: () => ({ inventory: {} }), check: () => {}, steps
      })
      assert.equal(recovered,0)
      assert.deepEqual(steps,[])
    }
  } finally { food.collectDrops = original }
})

test('failed pickup remains in preparation refusal evidence without crediting the dig', async () => {
  const bot = unarmedBot(), original = food.collectDrops
  bot.inventory.items = () => [{ name:'stick',count:1 },{ name:'stone_pickaxe',count:1 }]
  const blockAt = bot.blockAt
  bot.blockAt = p => p.equals(new Vec3(0,64,2)) ? { name:'air',position:p } : blockAt(p)
  bot.entities = { drop: { name:'item',isValid:true,position:new Vec3(.2,64,2.2),getDroppedItem:()=>({name:'cobblestone'}) } }
  food.collectDrops = async () => {} // no server inventory confirmation
  try {
    const result = await executePreparationStep({ enabled:true,bot,task:{type:'explorar'},
      production:{cachedCraftingTable:()=>({position:new Vec3(-1,64,-1)})},
      allowedTargets:[{x:0,y:64,z:2,name:'stone'},{x:2,y:64,z:0,name:'stone'}] })
    assert.equal(result.code,'APPROVED_TARGETS_INSUFFICIENT')
    assert.equal(result.steps[0].task,'recover_drop')
    assert.equal(result.steps[0].delta,0)
    assert.equal(result.steps[0].inventoryConfirmed,false)
    assert.equal(result.remainingPlan.collect.cobblestone,2)
    assert.equal(result.final.inventory.cobblestone||0,0)
  } finally { food.collectDrops = original }
})


test('recovery interruption preserves a zero-credit recovery step before movement', async () => {
  const target = new Vec3(2, 64, 0)
  const drop = {
    id: 17,
    name: 'item',
    isValid: true,
    position: new Vec3(2.2, 64, 0),
    getDroppedItem: () => ({ name: 'cobblestone' })
  }
  const bot = { entities: { drop }, blockAt: () => ({ name: 'air' }) }
  const original = food.collectDrops
  let cancelled = false
  const steps = []
  food.collectDrops = async (_bot, _center, _stopped, options) => {
    cancelled = true
    options.beforeMove(drop)
  }
  try {
    await assert.rejects(
      recoverApprovedCobblestoneDrops({
        bot,
        allowedTargets: [{ x: 2, y: 64, z: 0, name: 'stone' }],
        maxItems: 1,
        stopped: () => cancelled,
        snapshot: () => ({ inventory: {} }),
        check: () => { if (cancelled) throw new Error('CANCELLED') },
        steps
      }),
      /CANCELLED/
    )
    assert.equal(steps.length, 1)
    assert.equal(steps[0].selectedDropId, 17)
    assert.equal(steps[0].delta, 0)
    assert.equal(steps[0].inventoryConfirmed, false)
  } finally {
    food.collectDrops = original
  }
})

test('recovery never switches to a replacement cobblestone entity after selection', async () => {
  const target = new Vec3(2, 64, 0)
  const selected = {
    id: 21,
    name: 'item',
    isValid: true,
    position: new Vec3(2.2, 64, 0),
    getDroppedItem: () => ({ name: 'cobblestone' })
  }
  const replacement = {
    id: 22,
    name: 'item',
    isValid: true,
    position: new Vec3(2.3, 64, 0),
    getDroppedItem: () => ({ name: 'cobblestone' })
  }
  const bot = { entities: { selected }, blockAt: () => ({ name: 'air' }) }
  const original = food.collectDrops
  const steps = []
  food.collectDrops = async (_bot, _center, _stopped, options) => {
    assert.equal(options.matches(selected), true)
    assert.equal(options.matches(replacement), false)
    selected.isValid = false
    bot.entities = { replacement }
    options.beforeMove(selected)
  }
  try {
    await assert.rejects(
      recoverApprovedCobblestoneDrops({
        bot,
        allowedTargets: [{ x: 2, y: 64, z: 0, name: 'stone' }],
        maxItems: 1,
        stopped: () => false,
        snapshot: () => ({ inventory: {} }),
        check: () => {},
        steps
      }),
      /RECOVERY_DROP_CHANGED/
    )
    assert.equal(steps.length, 1)
    assert.equal(steps[0].selectedDropId, 21)
    assert.equal(steps[0].inventoryConfirmed, false)
  } finally {
    food.collectDrops = original
  }
})

test('recovery stops in-flight movement when its selected entity disappears', async () => {
  const { EventEmitter } = require('node:events')
  const drop = { id: 31, name: 'item', isValid: true, position: new Vec3(2, 64, 0), getDroppedItem: () => ({ name: 'cobblestone' }) }
  const bot = Object.assign(new EventEmitter(), { entities: { drop }, blockAt: () => ({ name: 'air' }), entity: {}, pathfinder: { setGoal(goal) { assert.equal(goal, null); stopped++ } } })
  let stopped = 0
  const steps = [], original = food.collectDrops
  food.collectDrops = async (_bot, _center, isCancelled, options) => {
    options.beforeMove(drop)
    bot.emit('entityGone', drop)
    assert.equal(isCancelled(), true)
    // A replacement entity must not be selected for another movement.
    assert.equal(options.matches({ ...drop, id: 32 }), false)
  }
  try {
    await assert.rejects(recoverApprovedCobblestoneDrops({ bot, allowedTargets: [{ x: 2, y: 64, z: 0, name: 'stone' }], maxItems: 1, snapshot: () => ({ inventory: {} }), check() {}, steps }), /RECOVERY_DROP_CHANGED/)
    assert.equal(stopped, 1)
    assert.equal(steps[0].delta, 0)
    assert.equal(steps[0].inventoryConfirmed, false)
    assert.equal(steps[0].interruption, 'RECOVERY_DROP_CHANGED')
    assert.equal(bot.listenerCount('entityGone'), 0)
    assert.equal(bot.listenerCount('playerCollect'), 0)
  } finally { food.collectDrops = original }
})

test('own pickup followed by entity removal still requires inventory confirmation', async () => {
  const { EventEmitter } = require('node:events')
  for (const confirmed of [false, true]) {
    const drop = { id: 41, name: 'item', isValid: true, position: new Vec3(2, 64, 0), getDroppedItem: () => ({ name: 'cobblestone' }) }
    const bot = Object.assign(new EventEmitter(), { entities: { drop }, blockAt: () => ({ name: 'air' }), entity: {}, pathfinder: { setGoal() { assert.fail('own pickup is not an unrelated disappearance') } } })
    const steps = [], original = food.collectDrops
    let inventory = {}
    food.collectDrops = async () => {
      bot.emit('playerCollect', bot.entity, drop)
      bot.emit('entityGone', drop)
      if (confirmed) inventory = { cobblestone: 1 }
    }
    try {
      const recovered = await recoverApprovedCobblestoneDrops({ bot, allowedTargets: [{ x: 2, y: 64, z: 0, name: 'stone' }], maxItems: 1, snapshot: () => ({ inventory }), check() {}, steps })
      assert.equal(recovered, confirmed ? 1 : 0)
      assert.equal(steps[0].pickupObserved, true)
      assert.equal(steps[0].inventoryConfirmed, confirmed)
      assert.equal(bot.listenerCount('entityGone'), 0)
      assert.equal(bot.listenerCount('playerCollect'), 0)
    } finally { food.collectDrops = original }
  }
})

test('integration preflight refuses exposed targets hidden by obstacles or supporting falling blocks', () => {
  const targets = [new Vec3(0, 64, 2), new Vec3(2, 64, 0)]
  const table = new Vec3(-1, 64, -1)
  let visible = true, falling = false
  const pickaxe = { name: 'stone_pickaxe', count: 1 }
  const bot = {
    entity: { position: new Vec3(0.5, 64, 0.5) },
    inventory: { items: () => [pickaxe] },
    registry: { blocksByName: { stone: { drops: [1] } }, items: { 1: { name: 'cobblestone' } } },
    pathfinder: { bestHarvestTool: () => pickaxe },
    canDigBlock: () => true,
    canSeeBlock: () => visible,
    blockAt: p => ({ position: p, name: p.equals(table) ? 'crafting_table' : targets.some(t => t.equals(p)) ? 'stone' : falling && targets.some(t => t.offset(0, 1, 0).equals(p)) ? 'gravel' : 'air' })
  }
  const args = {
    enabled: true, bot, production: { cachedCraftingTable: () => ({ position: table }) },
    objective: { type: 'explorar' },
    state: { health: 20, food: 20, inventory: { stick: 1, stone_pickaxe: 1 }, craftable: [], nearby: { stone: true }, objective: { type: 'explore' } },
    allowedTargets: targets.map(t => ({ x: t.x, y: t.y, z: t.z, name: 'stone' }))
  }
  assert.ok(preparationIntegrationTask(args))
  visible = false
  assert.equal(preparationIntegrationPreflight(args).code, 'APPROVED_TARGETS_INSUFFICIENT')
  assert.equal(preparationIntegrationTask(args), null)
  visible = true; falling = true
  assert.equal(preparationIntegrationTask(args), null)
  falling = false
  delete bot.canSeeBlock
  assert.equal(preparationIntegrationTask(args), null)
  bot.canSeeBlock = () => true
  delete bot.canDigBlock
  assert.equal(preparationIntegrationTask(args), null)
})


test('local-only preparation ignores configured storage and never invokes storage I/O', async () => {
  const f = recipePreparation()
  let storageCalls = 0
  f.pm.storage = {
    configured: () => true,
    withdraw: async () => { storageCalls++; throw new Error('storage withdraw must not run') },
    withdrawFirst: async () => { storageCalls++; throw new Error('storage withdrawFirst must not run') },
    deposit: async () => { storageCalls++; throw new Error('storage deposit must not run') }
  }

  const result = await executePreparationStep(f.args)

  assert.equal(result.ok, true)
  assert.equal(result.intent, 'prepare_combat')
  assert.equal(result.final.inventory.stone_sword, 1)
  assert.equal(f.bot.heldItem.name, 'stone_sword')
  assert.equal(storageCalls, 0)
  assert.equal(f.crafts(), 1)
})

test('preparation radius is 4 by default and opt-in up to 8 (walk once to a far source before mining)', async () => {
  const { preparationRadius } = require('../lib/forced-preparation')
  const saved = process.env.MBOT_PREPARATION_RADIUS
  try {
    delete process.env.MBOT_PREPARATION_RADIUS; assert.equal(preparationRadius(), 4)
    process.env.MBOT_PREPARATION_RADIUS = '99'; assert.equal(preparationRadius(), 8)
    process.env.MBOT_PREPARATION_RADIUS = '1'; assert.equal(preparationRadius(), 4)
    process.env.MBOT_PREPARATION_RADIUS = 'x'; assert.equal(preparationRadius(), 4)

    process.env.MBOT_PREPARATION_RADIUS = '8'
    const bot = unarmedBot(), items = [{ name:'stick', count:1 }, { name:'cobblestone', count:1 }, { name:'stone_pickaxe', count:1 }]
    const target = new Vec3(7, 64, 0)                       // 7 blocos: além do alcance, dentro do raio 8
    bot.inventory.items = () => items
    bot.blockAt = p => ({ name: p.equals(target) ? 'stone' : 'air', position:p })
    bot.registry = { blocksByName:{ stone:{ drops:[1] } }, items:{ 1:{ name:'cobblestone' } } }
    bot.pathfinder = { bestHarvestTool: () => items[2], setGoal() {} }
    const originalMine = gather.mineBlocks, originalGoTo = food.goTo
    const walks = []
    gather.mineBlocks = async (_, __, ___, ____, options) => { assert.equal(options.requireInReach, true); items[1].count++; options.onAttempt({ delta:1, itemConfirmed:true }); return 1 }
    food.goTo = async (_bot, goal) => { walks.push([goal.x, goal.z]); bot.entity.position = new Vec3(5, 64, 0) }
    try {
      const result = await executePreparationStep({ enabled:true, bot, task:{ type:'explorar' },
        production:{ cachedCraftingTable: () => ({ position:new Vec3(-1,64,-1) }) }, allowedTargets:[{ x:7,y:64,z:0,name:'stone' }] })
      assert.equal(result.ok, true)
      assert.deepEqual(walks[0], [7, 0])                    // caminhada única até o recurso
    } finally { gather.mineBlocks = originalMine; food.goTo = originalGoTo }
  } finally { if (saved === undefined) delete process.env.MBOT_PREPARATION_RADIUS; else process.env.MBOT_PREPARATION_RADIUS = saved }
})

test('clearStandingCell picks the side cell whose eye ray reaches the trunk (low leaves hide the others)', () => {
  const { clearStandingCell } = require('../lib/forced-preparation')
  const target = new Vec3(7, 64, 0)
  const bot = {
    entity: { position: new Vec3(0.5, 64, 0.5) },
    blockAt: p => p.equals(target) ? { name: 'oak_log', boundingBox: 'block', position: p }
      : p.y === 63 ? { name: 'dirt', boundingBox: 'block', position: p }
      : { name: 'air', boundingBox: 'empty', position: p },
    world: { raycast: (eye) => (Math.floor(eye.x) === 6 && Math.floor(eye.z) === 0 ? { position: target } : { position: new Vec3(Math.floor(eye.x) + 1, 65, Math.floor(eye.z)) }) }
  }
  // Só a célula oeste (6,64,0) enxerga o tronco; as outras raspam em folhas.
  assert.deepEqual(clearStandingCell(bot, target), new Vec3(6, 64, 0))
  bot.world.raycast = () => ({ position: new Vec3(0, 70, 0) })
  assert.equal(clearStandingCell(bot, target), null)             // nenhuma visível: cai no GoalNear
  delete bot.world
  assert.equal(clearStandingCell(bot, target), null)             // sem raycast: comportamento anterior
})
