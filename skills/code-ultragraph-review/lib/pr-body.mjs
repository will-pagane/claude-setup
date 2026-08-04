// lib/pr-body.mjs
// Build the markdown PR body for an autopilot review run (category-driven).

import { resolveCategory } from './categories.mjs'

export function buildPrBody({ date, category = 'performance', reportPath = '', findings = [], applied = [], notApplied = [], codex = {}, verification = {} } = {}) {
  const label = resolveCategory(category).label
  const lines = []
  if (verification.passed === false) {
    lines.push('> ⚠️ DRAFT: verificação não passou após auto-repair. Revisar antes de mergear.', '')
  }
  lines.push(`# ${label} review autopilot · ${date}`, '')
  lines.push(`Relatório completo: \`${reportPath}\``, '')

  lines.push('## Achados por severidade', '')
  const bySev = groupBy(findings, 'severity', ['critical', 'high', 'medium', 'low', 'info'])
  for (const [sev, items] of bySev) {
    lines.push(`### ${sev} (${items.length})`, '')
    for (const f of items) lines.push(`- ${f.title}`)
    lines.push('')
  }

  lines.push('## Fixes aplicados', '')
  if (applied.length === 0) lines.push('- nenhum')
  for (const f of applied) lines.push(`- [${f.via ?? '?'}] ${f.title} (\`${f.id}\`)`)
  lines.push('')

  if (notApplied.length) {
    lines.push('## Fixes NÃO aplicados', '')
    for (const f of notApplied) lines.push(`- ${f.title} (\`${f.id}\`) · ${f.reason ?? 'n/a'}`)
    lines.push('')
  }

  lines.push('## Codex headless', '')
  lines.push(`- rounds: ${codex.rounds ?? 0} · verdict: ${codex.verdict ?? 'skipped'}`, '')

  lines.push('## Verificação', '')
  const checks = verification.checks ?? {}
  for (const k of Object.keys(checks)) lines.push(`- ${k}: ${checks[k]}`)
  lines.push('')

  lines.push('---', `_Gerado por \`/code-ultragraph-review ${category} --autopilot\`._`)
  return lines.join('\n')
}

function groupBy(items, key, order) {
  const g = {}
  for (const it of items) {
    if (!g[it[key]]) g[it[key]] = []
    g[it[key]].push(it)
  }
  const keys = order ? order.filter((k) => k in g) : Object.keys(g)
  return keys.map((k) => [k, g[k]])
}

// CLI: node pr-body.mjs pr-input.json > pr-body.md
if (import.meta.url === `file://${process.argv[1]}` && process.argv[2]) {
  const { readFileSync } = await import('node:fs')
  const input = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  process.stdout.write(buildPrBody(input))
}
