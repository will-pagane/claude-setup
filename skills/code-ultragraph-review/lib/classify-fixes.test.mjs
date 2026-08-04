// lib/classify-fixes.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyFixes } from './classify-fixes.mjs'

test('disjoint mechanical fixes are isolated', () => {
  const { mechanicalIsolated, complexCoupled } = classifyFixes([
    { id: 'a', kind: 'mechanical', files: ['src/x.ts'] },
    { id: 'b', kind: 'mechanical', files: ['src/y.ts'] },
  ])
  assert.deepEqual(mechanicalIsolated.map((f) => f.id), ['a', 'b'])
  assert.equal(complexCoupled.length, 0)
})

test('mechanical fixes sharing a file are coupled', () => {
  const { mechanicalIsolated, complexCoupled } = classifyFixes([
    { id: 'a', kind: 'mechanical', files: ['src/x.ts'] },
    { id: 'b', kind: 'mechanical', files: ['src/x.ts'] },
  ])
  assert.equal(mechanicalIsolated.length, 0)
  assert.deepEqual(complexCoupled.map((f) => f.id).sort(), ['a', 'b'])
})

test('complex kind is always coupled even if file-isolated', () => {
  const { mechanicalIsolated, complexCoupled } = classifyFixes([
    { id: 'a', kind: 'complex', files: ['src/x.ts'] },
  ])
  assert.equal(mechanicalIsolated.length, 0)
  assert.deepEqual(complexCoupled.map((f) => f.id), ['a'])
})

test('a dependent fix is coupled; its mechanical dep can still be isolated', () => {
  const { mechanicalIsolated, complexCoupled } = classifyFixes([
    { id: 'b', kind: 'mechanical', files: ['src/y.ts'], dependsOn: ['a'] },
    { id: 'a', kind: 'mechanical', files: ['src/x.ts'] },
  ])
  assert.deepEqual(mechanicalIsolated.map((f) => f.id), ['a'])
  assert.deepEqual(complexCoupled.map((f) => f.id), ['b'])
})

test('coupled bucket is dependency-ordered (deps first)', () => {
  const { complexCoupled } = classifyFixes([
    { id: 'b', kind: 'complex', files: ['src/y.ts'], dependsOn: ['a'] },
    { id: 'a', kind: 'complex', files: ['src/x.ts'] },
  ])
  assert.deepEqual(complexCoupled.map((f) => f.id), ['a', 'b'])
})
