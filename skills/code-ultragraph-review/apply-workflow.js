export const meta = {
  name: 'apply-fixes',
  description: 'Apply mechanical-isolated fixes in parallel: one agent per fix, disjoint files',
  phases: [{ title: 'Apply' }],
}

const ROOT = (args && args.root) ? args.root : '.'
const FIXES = (args && Array.isArray(args.fixes)) ? args.fixes : []
const CATEGORY = (args && args.category) ? args.category : 'change'

const APPLY_RESULT = {
  type: 'object',
  required: ['status', 'filesTouched', 'note'],
  properties: {
    status: { type: 'string', enum: ['applied', 'failed'] },
    filesTouched: { type: 'array', items: { type: 'string' } },
    note: { type: 'string' },
  },
}

function applyPrompt(f) {
  return [
    'You apply ONE ' + CATEGORY + ' fix to a repository. Work ONLY on the files listed. Do not touch anything else.',
    'Repo root: ' + ROOT,
    'Fix title: ' + f.title,
    'Files (and ONLY these): ' + JSON.stringify(f.files),
    'What to change: ' + (f.proposed_solution ?? ''),
    'Concrete hint: ' + (f.patchHint ?? '(none)'),
    'Steps: (1) Read each listed file. (2) Apply the minimal change that implements the fix without altering behavior beyond the intended ' + CATEGORY + ' improvement. (3) Re-read your edit to confirm it is syntactically valid and self-consistent.',
    'If the fix cannot be applied safely to ONLY these files, make NO edits and return status "failed" with the reason in note.',
    'Return status "applied" with the exact files you changed in filesTouched, else "failed".',
  ].join('\n')
}

if (FIXES.length === 0) {
  return { results: [] }
}

const results = await parallel(
  FIXES.map((f) => () =>
    agent(applyPrompt(f), { label: `apply:${f.id}`, phase: 'Apply', schema: APPLY_RESULT })
      .then((r) => ({ id: f.id, title: f.title, ...r }))
      .catch(() => ({ id: f.id, title: f.title, status: 'failed', filesTouched: [], note: 'agent error' }))
  )
)

return { results }
