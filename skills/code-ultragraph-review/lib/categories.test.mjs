// lib/categories.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORY_REGISTRY, resolveCategory } from './categories.mjs'

test('registry has exactly the five missions', () => {
  assert.deepEqual(
    Object.keys(CATEGORY_REGISTRY).sort(),
    ['cleanup', 'code-health', 'correctness', 'performance', 'security'],
  )
})

test('every entry is well-formed', () => {
  for (const [key, c] of Object.entries(CATEGORY_REGISTRY)) {
    assert.equal(c.key, key)
    assert.ok(Array.isArray(c.includeCategories) && c.includeCategories.length > 0, `includeCategories empty for ${key}`)
    assert.ok(typeof c.branchPrefix === 'string' && c.branchPrefix.length > 0)
    assert.ok(typeof c.prTitlePrefix === 'string' && c.prTitlePrefix.length > 0)
    assert.equal(c.prMode, 'ready')
    assert.ok([null, 'performance', 'security'].includes(c.dbImpact))
    assert.ok(c.signals === null || (Array.isArray(c.signals.advisorTypes) && Array.isArray(c.signals.logServices) && c.signals.logRx instanceof RegExp))
  }
})

test('branchPrefix values are unique', () => {
  const prefixes = Object.values(CATEGORY_REGISTRY).map((c) => c.branchPrefix)
  assert.equal(new Set(prefixes).size, prefixes.length)
})

test('resolveCategory returns entry and falls back to performance', () => {
  assert.equal(resolveCategory('security').key, 'security')
  assert.equal(resolveCategory('bogus').key, 'performance')
  assert.equal(resolveCategory(undefined).key, 'performance')
})

test('cleanup and code-health have no signal provider', () => {
  assert.equal(CATEGORY_REGISTRY.cleanup.signals, null)
  assert.equal(CATEGORY_REGISTRY['code-health'].signals, null)
})
