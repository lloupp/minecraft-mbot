// test/route-memory.test.js
// Tests for the route memory system.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { RouteMemory } = require('../lib/route-memory')

test('register and get waypoint', () => {
  const routeMemory = new RouteMemory()
  routeMemory.register('wp1', { x: 100, y: 64, z: 200 }, { type: 'mine', resources: ['iron_ore'] })
  const wp = routeMemory.getAll()[0]
  assert.equal(wp.position.x, 100)
  assert.equal(wp.type, 'mine')
})

test('mark as visited', () => {
  const routeMemory = new RouteMemory()
  routeMemory.register('wp1', { x: 0, y: 64, z: 0 }, { type: 'chest', resources: ['diamond'] })
  assert.equal(routeMemory.isVisited('wp1'), false)
  routeMemory.visit('wp1', ['diamond'])
  assert.equal(routeMemory.isVisited('wp1'), true)
})

test('mark complete', () => {
  const routeMemory = new RouteMemory()
  routeMemory.register('wp1', { x: 0, y: 64, z: 0 })
  assert.equal(routeMemory.isComplete('wp1'), false)
  routeMemory.complete('wp1')
  assert.equal(routeMemory.isComplete('wp1'), true)
})

test('getIncomplete filters completed', () => {
  const routeMemory = new RouteMemory()
  routeMemory.register('wp1', { x: 0, y: 64, z: 0 })
  routeMemory.register('wp2', { x: 10, y: 64, z: 0 }, { type: 'mine' })
  routeMemory.complete('wp1')
  const incomplete = routeMemory.getIncomplete()
  assert.equal(incomplete.length, 1)
  assert.equal(incomplete[0].id, 'wp2')
})

test('getRemaining returns uncollected resources', () => {
  const routeMemory = new RouteMemory()
  routeMemory.register('wp1', { x: 0, y: 64, z: 0 }, { resources: ['iron_ore', 'diamond'] })
  routeMemory.visit('wp1', ['iron_ore'])
  assert.ok(routeMemory.getRemaining('wp1').includes('diamond'))
  assert.ok(!routeMemory.getRemaining('wp1').includes('iron_ore'))
})

test('getNearest returns closest waypoint', () => {
  const routeMemory = new RouteMemory()
  routeMemory.register('wp1', { x: 0, y: 64, z: 0 })
  routeMemory.register('wp2', { x: 100, y: 64, z: 0 })
  const nearest = routeMemory.getNearest({ x: 5, y: 64, z: 0 }, 50)
  assert.equal(nearest.id, 'wp1')
})

test('getNearest returns null when out of range', () => {
  const routeMemory = new RouteMemory()
  routeMemory.register('wp1', { x: 0, y: 64, z: 0 })
  const nearest = routeMemory.getNearest({ x: 1000, y: 64, z: 0 }, 50)
  assert.equal(nearest, null)
})

test('stats returns correct counts', () => {
  const routeMemory = new RouteMemory()
  routeMemory.register('wp1', { x: 0, y: 64, z: 0 })
  routeMemory.register('wp2', { x: 10, y: 64, z: 0 }, { type: 'mine' })
  routeMemory.complete('wp1')
  const stats = routeMemory.stats
  assert.equal(stats.total, 2)
  assert.equal(stats.completed, 1)
  assert.equal(stats.incomplete, 1)
})
