// lib/classify-fixes.mjs
// Route proposed fixes into parallel-safe (mechanical-isolated) vs sequential
// (complex-coupled) buckets. A fix is mechanical-isolated iff ALL hold:
//   - kind === 'mechanical'
//   - no declared dependsOn
//   - none of its files is touched by any OTHER fix (file-set disjoint)
// Otherwise complex-coupled. Coupled is returned in dependency order
// (deps before dependents; input order breaks ties).

export function classifyFixes(fixes) {
  const byId = new Map(fixes.map((f) => [f.id, f]))
  const fileOwners = new Map() // file -> Set(fixId)
  for (const f of fixes) {
    for (const file of f.files ?? []) {
      if (!fileOwners.has(file)) fileOwners.set(file, new Set())
      fileOwners.get(file).add(f.id)
    }
  }
  const sharesFile = (f) =>
    (f.files ?? []).some((file) => (fileOwners.get(file)?.size ?? 0) > 1)

  const mechanicalIsolated = []
  const coupled = []
  for (const f of fixes) {
    const mechanical = f.kind === 'mechanical'
    const hasDeps = (f.dependsOn ?? []).length > 0
    if (mechanical && !hasDeps && !sharesFile(f)) mechanicalIsolated.push(f)
    else coupled.push(f)
  }
  return { mechanicalIsolated, complexCoupled: topoSort(coupled, byId) }
}

function topoSort(fixes, byId) {
  const inSet = new Set(fixes.map((f) => f.id))
  const seen = new Set()
  const order = []
  const visit = (f) => {
    if (!f || seen.has(f.id)) return
    seen.add(f.id)
    for (const dep of f.dependsOn ?? []) if (inSet.has(dep)) visit(byId.get(dep))
    order.push(f)
  }
  for (const f of fixes) visit(f)
  return order
}

// CLI: node classify-fixes.mjs fixes.json > buckets.json
if (import.meta.url === `file://${process.argv[1]}` && process.argv[2]) {
  const { readFileSync } = await import('node:fs')
  const input = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const fixes = Array.isArray(input) ? input : input.fixes ?? []
  process.stdout.write(JSON.stringify(classifyFixes(fixes), null, 2))
}
