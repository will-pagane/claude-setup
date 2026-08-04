// lib/normalize-signals.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSignals } from './normalize-signals.mjs'

test('advisors become signals with mapped severity', () => {
  const out = normalizeSignals({
    advisors: [{ level: 'WARN', title: 'unused_index', description: 'idx_foo unused', metadata: { name: 'idx_foo' } }],
  })
  assert.equal(out.signals.length, 1)
  assert.equal(out.signals[0].source, 'advisor')
  assert.equal(out.signals[0].target, 'idx_foo')
  assert.equal(out.signals[0].severity, 'medium')
})

test('edge timeout/memory logs are high severity', () => {
  const out = normalizeSignals({
    edgeLogs: [{ event_message: 'Function killed: exceeded memory limit', metadata: { function_id: 'webhook-ml' } }],
  })
  assert.equal(out.signals[0].source, 'edge-function')
  assert.equal(out.signals[0].severity, 'high')
  assert.equal(out.signals[0].target, 'webhook-ml')
})

test('non-perf postgres logs are filtered out', () => {
  const out = normalizeSignals({
    postgresLogs: [{ event_message: 'connection authorized: user=app' }],
  })
  assert.equal(out.signals.length, 0)
})

test('duplicate signals are collapsed', () => {
  const dup = { level: 'INFO', title: 'unindexed_fk', description: 'fk on orders', metadata: { name: 'orders.seller_id' } }
  const out = normalizeSignals({ advisors: [dup, dup] })
  assert.equal(out.signals.length, 1)
  assert.equal(out.counts.advisor, 1)
})

import { resolveCategory } from './categories.mjs'

test('security logRx matches auth-denied postgres logs', () => {
  const rx = resolveCategory('security').signals.logRx
  const out = normalizeSignals(
    { postgresLogs: [{ event_message: 'permission denied for table sellers', error_severity: 'ERROR' }] },
    { logRx: rx },
  )
  assert.equal(out.signals.length, 1)
  assert.equal(out.signals[0].source, 'postgres')
  assert.equal(out.signals[0].severity, 'high')
})

test('security logRx filters out pure-perf logs', () => {
  const rx = resolveCategory('security').signals.logRx
  const out = normalizeSignals(
    { postgresLogs: [{ event_message: 'sequential scan on orders took 5000ms' }] },
    { logRx: rx },
  )
  assert.equal(out.signals.length, 0)
})

test('authLogs are incorporated under the auth source', () => {
  const rx = resolveCategory('security').signals.logRx
  const out = normalizeSignals(
    { authLogs: [{ event_message: 'invalid jwt: token expired', metadata: { name: 'auth-gateway' } }] },
    { logRx: rx },
  )
  assert.equal(out.signals.length, 1)
  assert.equal(out.signals[0].source, 'auth')
})

test('default call (no opts) keeps performance behavior', () => {
  const out = normalizeSignals({ edgeLogs: [{ event_message: 'Function killed: exceeded memory limit', metadata: { function_id: 'f1' } }] })
  assert.equal(out.signals.length, 1)
  assert.equal(out.signals[0].severity, 'high')
})
