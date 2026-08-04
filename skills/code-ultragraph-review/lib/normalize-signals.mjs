// lib/normalize-signals.mjs
// Collapse raw Supabase advisor + postgres/edge log payloads into a compact,
// deduped signal list the review workflow can prioritize on.

const PERF_RX = /slow|duration|timeout|memory|killed|oom|deadlock|lock wait|statement timeout|5\d\d|too many|n\+1|sequential scan/i

export function normalizeSignals({ advisors = [], postgresLogs = [], edgeLogs = [], authLogs = [], window = '24h' } = {}, opts = {}) {
  const rx = opts.logRx || PERF_RX
  const signals = []
  for (const a of advisors) {
    signals.push({
      source: 'advisor',
      severity: mapAdvisorLevel(a.level),
      target: a.metadata?.name ?? a.title ?? 'unknown',
      detail: truncate(a.description ?? a.title ?? '', 240),
    })
  }
  for (const l of postgresLogs) {
    const msg = l.event_message ?? ''
    if (!rx.test(msg)) continue
    signals.push({
      source: 'postgres',
      severity: l.error_severity && /error|fatal|panic/i.test(l.error_severity) ? 'high' : 'medium',
      target: extractTarget(l),
      detail: truncate(msg, 240),
    })
  }
  for (const l of edgeLogs) {
    const msg = l.event_message ?? ''
    if (!rx.test(msg)) continue
    signals.push({
      source: 'edge-function',
      severity: /timeout|memory|killed|oom|5\d\d/i.test(msg) ? 'high' : 'medium',
      target: l.metadata?.function_id ?? extractTarget(l),
      detail: truncate(msg, 240),
    })
  }
  for (const l of authLogs) {
    const msg = l.event_message ?? ''
    if (!rx.test(msg)) continue
    signals.push({
      source: 'auth',
      severity: /401|403|forbidden|unauthorized|denied|leaked|invalid (jwt|token)/i.test(msg) ? 'high' : 'medium',
      target: extractTarget(l),
      detail: truncate(msg, 240),
    })
  }
  const deduped = dedup(signals)
  return { generatedFor: window, signals: deduped, counts: countBy(deduped) }
}

function mapAdvisorLevel(level) {
  const v = String(level ?? '').toUpperCase()
  if (v === 'ERROR') return 'high'
  if (v === 'WARN') return 'medium'
  return 'low'
}
function extractTarget(l) {
  return l.metadata?.name ?? l.metadata?.relation ?? l.identifier ?? 'unknown'
}
function truncate(s, n) {
  s = String(s)
  return s.length > n ? s.slice(0, n) + '…' : s
}
function dedup(signals) {
  const seen = new Set()
  const out = []
  for (const s of signals) {
    const k = `${s.source}|${s.target}|${s.detail}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}
function countBy(signals) {
  const c = {}
  for (const s of signals) c[s.source] = (c[s.source] ?? 0) + 1
  return c
}

// CLI: node normalize-signals.mjs <raw-signals.json> <category> > signals.json
if (import.meta.url === `file://${process.argv[1]}` && process.argv[2]) {
  const { readFileSync } = await import('node:fs')
  const { resolveCategory } = await import('./categories.mjs')
  const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const cat = resolveCategory(process.argv[3])
  const logRx = cat.signals?.logRx ?? PERF_RX
  process.stdout.write(JSON.stringify(normalizeSignals(raw, { logRx }), null, 2))
}
