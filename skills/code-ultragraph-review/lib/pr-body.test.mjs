// lib/pr-body.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPrBody } from './pr-body.mjs'

const base = {
  date: '2026-06-18',
  reportPath: 'docs/code-review-performance-2026-06-18.md',
  findings: [
    { severity: 'high', category: 'performance', title: 'N+1 in seller list' },
    { severity: 'medium', category: 'performance', title: 'missing index' },
  ],
  applied: [{ id: 'a', title: 'add index', via: 'parallel' }],
  notApplied: [{ id: 'b', title: 'refactor query', reason: 'agent failed' }],
  codex: { rounds: 2, verdict: 'APPROVED' },
  verification: { passed: true, checks: { lint: 'pass', test: 'pass', build: 'pass' } },
}

test('green run has no DRAFT marker and lists counts', () => {
  const md = buildPrBody(base)
  assert.ok(!md.includes('DRAFT'))
  assert.ok(md.includes('high'))
  assert.ok(md.includes('N+1 in seller list'))
  assert.ok(md.includes('add index'))
  assert.ok(md.includes('refactor query'))
  assert.ok(md.includes(base.reportPath))
})

test('failed verification marks the PR as DRAFT', () => {
  const md = buildPrBody({ ...base, verification: { passed: false, checks: { lint: 'pass', test: 'fail' } } })
  assert.ok(md.includes('DRAFT'))
  assert.ok(md.includes('test'))
})

test('category drives the title and footer', () => {
  const md = buildPrBody({ ...base, category: 'security' })
  assert.ok(md.includes('Security review autopilot'))
  assert.ok(md.includes('/code-ultragraph-review security --autopilot'))
  assert.ok(!md.includes('Performance review autopilot'))
})

test('default category remains performance', () => {
  const md = buildPrBody(base)
  assert.ok(md.includes('Performance review autopilot'))
})
