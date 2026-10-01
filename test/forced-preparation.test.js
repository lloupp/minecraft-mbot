const test = require('node:test')
const assert = require('node:assert/strict')
const { preparationPlan, preparationDispatchTask, executePreparationStep } = require('../lib/forced-preparation')
const gather = require('../lib/gather')
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
  args.production.storage = { configured: () => true }
  assert.equal((await executePreparationStep(args)).code, 'LOCAL_PRODUCTION_REQUIRED')
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
