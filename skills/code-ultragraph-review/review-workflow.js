export const meta = {
  name: 'code-ultragraph-review',
  description: 'Graph-informed multi-agent deep code review for any project: recon + graph-mine, per-unit review across all finding classes, adversarial verification, dedup, severity-ranked findings. Generic — discovers stack, conventions, integrations and the review-unit partition at runtime.',
  phases: [
    { title: 'Map', detail: 'Recon project + partition into review units; graph-mine dead-code/dup/hub candidates' },
    { title: 'Review', detail: 'Per-unit + global + (optional) DB reviewers across all finding classes' },
    { title: 'Verify', detail: 'Adversarial per-unit verification of every finding' },
    { title: 'Synthesize', detail: 'Dedup by category + severity ranking' },
  ],
}

// ----- inputs (from the skill, via Workflow args) -----
const ROOT = (args && args.root) ? args.root : '.'
const GRAPH_DIR = (args && args.graphDir) ? args.graphDir : 'graphify-out'
const SIGNALS = (args && Array.isArray(args.signals?.signals)) ? args.signals.signals : []
const SIGNALS_BLOCK = SIGNALS.length
  ? [
      'RUNTIME SIGNALS (from Supabase advisors + postgres/edge/auth logs, PRIORITIZE review units and findings that touch these targets):',
      ...SIGNALS.slice(0, 60).map((s) => `- [${s.severity}] ${s.source} · ${s.target} · ${s.detail}`),
    ].join('\n')
  : 'RUNTIME SIGNALS: none provided (review on graph + static analysis alone).'

const CATEGORIES = [
  'duplication', 'dead_code', 'unifiable', 'incomplete_impl', 'performance',
  'security', 'type_safety', 'error_handling', 'correctness', 'convention',
  'db_integrity', 'accessibility', 'maintainability',
]

const DIMENSIONS = [
  'REVIEW DIMENSIONS — inspect the code for EVERY class below; report each real instance:',
  '1. duplication — copy-pasted blocks / repeated logic that exists in more than one place.',
  '2. dead_code — unused exports, unreachable branches, commented-out code, orphan files, unused props/vars/imports, components/functions never referenced.',
  '3. unifiable — near-duplicate code differing only slightly that should be extracted into a shared helper/component/module.',
  '4. incomplete_impl — TODO/FIXME/HACK, stubs returning nothing, placeholder UI, declared-but-unwired handlers, empty catch blocks, half-built features, controls with no handler, routes/endpoints pointing to placeholders.',
  '5. performance — N+1 queries, unbounded fetches / SELECT *, missing pagination, missing memoization causing re-renders, expensive work in hot paths, missing caching, eager heavy imports, large payloads, DB index implied by filters/sorts but likely missing.',
  '6. security — secrets/keys in client code, privileged-credential exposure, missing input validation at boundaries, missing auth/permission gate, authz bypass, missing access-control policy, SQL/command built by string concat, overly-open CORS, returning sensitive data to clients.',
  '7. type_safety — escape hatches that defeat the type system (untyped values, suppression comments without justification, unsafe non-null assertions on nullable values, hand-written shapes that should be generated, type-only imports not marked as such). Adapt to the project language.',
  '8. error_handling — error results ignored before using data, swallowed exceptions, single-row assumptions on multi/zero-row queries, error responses that break the caller contract, missing error boundaries, unhandled promise rejections.',
  '9. correctness — logic bugs, off-by-one, wrong conditions, stale closures, wrong/missing effect dependencies, race conditions, timezone/datetime mishandling, incorrect calculations.',
  '10. convention — violations of the project conventions captured in PROJECT CONTEXT (style, design rules, documented patterns), and naming-convention mixing within a file/module.',
  '11. db_integrity — (backend/DB units) missing row-level security, missing/implicit FK delete behavior, function/view/policy redefinition that silently drops a column/predicate/grant an earlier migration added, missing index on FK or filtered column, non-idempotent migration, missing constraints.',
  '12. accessibility — missing aria/labels/alt text, non-semantic elements, keyboard traps, focus issues (lower priority unless egregious).',
  '13. maintainability — materially harmful issues not covered above (god functions, deep nesting, magic numbers in critical paths).',
].join('\n')

const GROUNDING = [
  'GROUNDING RULES (mandatory — do not violate):',
  '- READ the actual files before reporting. Use the Read tool and ripgrep (Grep / Bash rg). Never guess.',
  '- Every finding MUST be grounded in a real location: exact relative path + line number or range. Put a short real code snippet in `evidence`.',
  '- Do NOT invent issues. If unsure whether something is a real problem, verify it or omit it. Prefer precision over volume, but report every real issue you find (no silent cap).',
  '- `confidence` = your honest 0..1 probability the finding is real and material.',
  '- `context` = the minimal explanation needed to locate and understand the problem (1-3 sentences).',
  '- `proposed_solution` = concrete fix (what to change), 1-3 sentences.',
  '- `current_impact` = the negative impact this causes RIGHT NOW (bug risk, perf cost, security exposure, maintenance burden). If purely latent, say so.',
  '- severity: critical = active security hole / data loss / production-breaking; high = real bug or serious likely-to-bite risk; medium = notable, should fix; low = minor; info = trivial/nice-to-have.',
  '- Write all output in English.',
].join('\n')

// Fix-safety good practices: a proposed_solution must not trade one bug for another.
// These deepen the report's Solution field so the recommended remedy is itself safe.
const FIX_SAFETY = [
  'FIX-SAFETY GOOD PRACTICES (pressure-test every proposed_solution against how the code is REALLY invoked — a fix that silently breaks a legitimate path is worse than the bug):',
  '- A remedy is only valid if it survives the same scrutiny as the bug. When the fix is non-trivial, state in proposed_solution what you verified (actual callers, name-resolution path, data shape) so the next reader trusts it.',
  '- AUTHZ GATES must be tied to REAL callers. When proposing to ADD or CHANGE a permission/role/auth gate on a function/endpoint/RPC, FIRST grep for its actual callers and the permission(s) those callers hold, then gate on a permission the legitimate callers ACTUALLY have (accept the union when several flows call it) — never a slug/role that is merely topically related. A gate keyed to the wrong permission silently denies legitimate users (e.g. gating a seller lookup that is only invoked by the lead-closing flow on an unrelated integration-page permission locks out the operators who close leads). Name the caller(s) and the chosen permission in the solution.',
  '- DB search_path hardening must PRESERVE cross-schema resolution. When proposing to set a fixed search_path (e.g. `public, pg_temp`) to clear the mutable-search_path lint, FIRST read the function body for UNQUALIFIED calls to objects outside public/pg_catalog — especially extension functions (pgcrypto digest/crypt/gen_salt/hmac/encrypt, uuid-ossp uuid_generate_*, pgsodium, postgis) which live in the `extensions` (or a dedicated) schema, plus unqualified `vault`/other-schema references. If any exist, the fix MUST either include that schema in the path (e.g. `public, extensions, pg_temp` — still a FIXED path, so the lint stays resolved) OR fully-qualify those calls; a bare `public, pg_temp` breaks them at call time. (pg_catalog is always implicitly searched, so built-ins never break — and note that `ALTER FUNCTION ... SET search_path` is config-only but is NOT zero-risk for bodies with unqualified cross-schema calls.)',
].join('\n')

const FINDING_ITEM = {
  type: 'object',
  required: ['category', 'severity', 'title', 'location', 'context', 'proposed_solution', 'current_impact', 'confidence', 'evidence'],
  properties: {
    category: { type: 'string', enum: CATEGORIES },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
    title: { type: 'string' },
    location: { type: 'string', description: 'relative path + line/range or symbol' },
    context: { type: 'string' },
    proposed_solution: { type: 'string' },
    current_impact: { type: 'string' },
    confidence: { type: 'number' },
    evidence: { type: 'string', description: 'short real code snippet proving the issue' },
  },
}
const FINDINGS_SCHEMA = { type: 'object', required: ['findings'], properties: { findings: { type: 'array', items: FINDING_ITEM } } }

const VERIFY_ITEM = {
  type: 'object',
  required: ['category', 'severity', 'title', 'location', 'context', 'proposed_solution', 'current_impact', 'confidence', 'evidence', 'confirmed', 'verification_note'],
  properties: Object.assign({}, FINDING_ITEM.properties, {
    confirmed: { type: 'boolean', description: 'true iff the finding survives adversarial verification against the real code' },
    verification_note: { type: 'string' },
  }),
}
const VERIFY_SCHEMA = { type: 'object', required: ['findings'], properties: { findings: { type: 'array', items: VERIFY_ITEM } } }

const RECON_SCHEMA = {
  type: 'object',
  required: ['projectContext', 'units', 'integrations', 'dbMode'],
  properties: {
    projectContext: { type: 'string', description: 'compiled stack + conventions + project-specific bug sources + known issues' },
    units: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'label', 'scope', 'kind'],
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          scope: { type: 'string', description: 'paths/globs the reviewer should enumerate and read' },
          kind: { type: 'string', enum: ['frontend', 'backend', 'edge', 'db', 'lib', 'config', 'mixed'] },
        },
      },
    },
    integrations: { type: 'array', items: { type: 'string' } },
    dbMode: { type: 'string', enum: ['supabase', 'sql-static', 'none'] },
    notes: { type: 'string' },
  },
}

const MAP_SCHEMA = {
  type: 'object',
  required: ['deadCodeCandidates', 'duplicationCandidates', 'hubFiles', 'notes'],
  properties: {
    deadCodeCandidates: { type: 'array', items: { type: 'string' } },
    duplicationCandidates: { type: 'array', items: { type: 'object', required: ['files', 'note'], properties: { files: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } } } },
    hubFiles: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

function buildReviewerPrompt(unit, projectContext) {
  const efNote = (unit.kind === 'edge' || unit.kind === 'backend')
    ? '\nThis is a BACKEND/EDGE unit. Pay extra attention to: input validation at the boundary, authn/authz handling, CORS, secret handling (env, never hardcode, never return secrets), the caller error contract, privileged-credential usage, and idempotency.'
    : ''
  return [
    'You are a meticulous senior code reviewer. Review ONLY the scope below, but read whatever you need (imported files, types, schema) to judge correctly.',
    '', 'PROJECT CONTEXT:', projectContext, '',
    'SCOPE (review unit "' + unit.key + '" — ' + unit.label + '):', unit.scope, efNote, '',
    DIMENSIONS, '', GROUNDING, '', FIX_SAFETY, '',
    'Enumerate the files in your scope first (rg --files / ls under ' + ROOT + '), then read each. Return ALL real findings via the structured tool. If the unit is clean, return an empty findings array.',
    SIGNALS_BLOCK,
  ].join('\n')
}

function buildVerifierPrompt(unitLabel, projectContext, findingsJson) {
  return [
    'You are an adversarial verifier. Your job is to REFUTE findings, not agree. A reviewer produced the findings below for unit "' + unitLabel + '".',
    '', 'PROJECT CONTEXT:', projectContext, '',
    'For EACH finding: open the cited file at the cited location, read the surrounding code, and decide if the problem is REAL and material as described.',
    '- confirmed=false if: the location is wrong, the code does not have the issue, the framework/library already handles it, it is intentional/correct, it duplicates another finding, or it is speculative without evidence.',
    '- confirmed=true only if you independently reproduced the problem by reading the code.',
    '- Adjust `severity` honestly. Fix slightly-wrong location/evidence if the issue is real. Put reasoning in verification_note. Default to confirmed=false when genuinely uncertain.',
    'ALSO pressure-test each proposed_solution for FIX-SAFETY: if the remedy as written would itself introduce a regression, REWRITE proposed_solution to the safe form (keep confirmed=true — the bug is real) and explain the correction in verification_note. Two recurring traps to catch: (a) an authz/permission gate keyed to a slug/role that the ACTUAL callers of the function do not hold (grep the callers; gate on a permission they really have, or the union) — a wrong slug silently denies legitimate users; (b) a `SET search_path = public, pg_temp` fix on a function whose body calls extension/other-schema objects UNQUALIFIED (pgcrypto digest/crypt, uuid_generate_*, pgsodium, vault.*) — that breaks the function at call time; the safe form includes the needed schema (e.g. `public, extensions, pg_temp`) or fully-qualifies the calls.',
    'Return the SAME findings array with confirmed + verification_note added for every item. Add no new findings. English.',
    '', 'FINDINGS TO VERIFY (JSON):', findingsJson,
  ].join('\n')
}

function globalPasses(projectContext, mapHints, dbMode) {
  const hints = mapHints ? ('\nGRAPH HINTS (leads to verify, not facts):\n' + JSON.stringify(mapHints).slice(0, 6000)) : ''
  const base = (extra) => [projectContext, hints, DIMENSIONS, GROUNDING, FIX_SAFETY, extra].join('\n\n')
  const passes = [
    { key: 'g-dead', label: 'Global: dead code', kind: 'mixed', prompt: base(
      'You are a dead-code auditor for the whole repo at ' + ROOT + '. Find unused exports, orphan files, components/functions never referenced, unreachable branches, commented-out blocks, unused dependencies. Try a language-appropriate tool if present (e.g. knip/ts-prune for JS/TS, vulture for Python) via npx/pipx; otherwise cross-reference with ripgrep. Account for entrypoints, dynamic imports, routed pages, test files, barrel re-exports, framework primitives — do NOT flag those as dead unless truly orphan. Category dead_code. Show grep evidence proving zero references.') },
    { key: 'g-dup', label: 'Global: duplication & unifiable', kind: 'mixed', prompt: base(
      'You are a duplication auditor for the whole repo at ' + ROOT + '. Find (a) duplicated code blocks/logic across files and (b) near-duplicate code that should be unified into a shared helper/component/module. Try jscpd via npx if available; otherwise ripgrep for repeated bodies, query shapes, mapping/formatting logic, scaffolding, constants/types. Categories duplication and unifiable. In `location` list ALL involved files:lines; show the duplicated snippet in evidence.') },
    { key: 'g-conv', label: 'Global: conventions', kind: 'mixed', prompt: base(
      'You are a convention auditor for the whole repo at ' + ROOT + '. Derive the documented conventions and anti-patterns from PROJECT CONTEXT and grep for violations across the codebase (style rules, design rules, banned patterns, suppression comments without justification, type-system escape hatches, naming-convention mixing). Verify each grep hit is a real violation (not inside a comment/string) before reporting. Categories convention, type_safety.') },
    { key: 'g-missing', label: 'Global: incomplete/missing impl', kind: 'mixed', prompt: base(
      'You audit incomplete/missing implementation across the repo at ' + ROOT + '. ripgrep for TODO/FIXME/HACK/XXX, placeholders, "coming soon", "not implemented", empty bodies, no-op handlers, stubbed services. Cross-check declared routes/endpoints/commands (and any route map in project docs) against what is actually implemented; flag entries that point to stubs or that reference RPCs/functions/endpoints that do not exist. Category incomplete_impl. State what is missing and what references it.') },
    { key: 'g-sec', label: 'Global: cross-cutting security', kind: 'backend', prompt: base(
      'You are a security auditor for the whole repo at ' + ROOT + '. Cross-cutting issues a single-file review misses: privileged credentials/secrets in client code, hardcoded keys/tokens (search for secret-like literals, Bearer, apikey), missing input validation at boundaries, broad CORS on authed endpoints, secrets logged or returned in responses, SQL/command string concatenation, client-trusted identity. Honor any project-specific secret rules in PROJECT CONTEXT. Verify each before reporting — a false alarm is costly. Category security.') },
  ]
  if (dbMode === 'supabase') {
    passes.push({ key: 'db-advisors', label: 'DB: Supabase advisors', kind: 'db', prompt: [
      'You are a database auditor with live Supabase access via MCP for repo ' + ROOT + '.',
      'Use ToolSearch to load tools: query "select:mcp__supabase__get_advisors,mcp__supabase__list_tables" (fallback prefix mcp__claude_ai_Supabase__). Call get_advisors type "security", then type "performance", then list_tables.',
      'Convert each advisor lint into a finding (db_integrity / security / performance). location = object name + lint name. context = lint detail. proposed_solution = advisor remediation. current_impact = exposure/cost. evidence = raw lint title/level. Also flag any user-data table with RLS disabled.',
      'For the mutable-search_path lint specifically, do NOT blindly recommend `SET search_path = public, pg_temp` — apply the search_path FIX-SAFETY rule below (check the body for unqualified extension/cross-schema calls first).',
      GROUNDING, FIX_SAFETY, 'English. If MCP is unreachable, return one info finding saying so.',
    ].join('\n\n') })
    passes.push({ key: 'db-rls-rpc', label: 'DB: RLS / function regression / indexes', kind: 'db', prompt: [
      'You are a database auditor with live Supabase access via MCP for repo ' + ROOT + '.',
      'Use ToolSearch: query "select:mcp__supabase__execute_sql,mcp__supabase__list_tables" (fallback mcp__claude_ai_Supabase__). Run read-only SELECTs only — never mutate.',
      'PROJECT CONTEXT:', projectContext,
      'Focus: (1) Function regression — read high-value RPC/function definitions via pg_get_functiondef and diff against the migration history in the repo to detect silently-dropped output columns / WHERE predicates / ORDER BY / GRANT / SECURITY clauses. (2) Missing indexes — compare pg_indexes against FK columns and columns used in hot WHERE/ORDER BY filters. (3) RLS — for sensitive tables read pg_policies and confirm they use the project auth function and do not leak across users.',
      GROUNDING, FIX_SAFETY, 'Categories db_integrity, security, performance. Cite exact object + discrepancy in evidence. English. If MCP is unreachable, return one info finding saying so.',
    ].join('\n\n') })
  } else if (dbMode === 'sql-static') {
    passes.push({ key: 'db-static', label: 'DB: static schema/migration review', kind: 'db', prompt: base(
      'You review database schema/migration files statically in the repo at ' + ROOT + ' (no live DB). Find: tables with user data lacking access-control/RLS, FKs without explicit delete behavior, missing indexes on FK/filter columns, non-idempotent migrations, missing constraints, and function/view redefinitions that drop a column/predicate an earlier migration added. Category db_integrity. Cite the migration file:line.') })
  }
  return passes
}

// ===================== ORCHESTRATION =====================
phase('Map')
log('Recon + graph-mining (graph dir: ' + GRAPH_DIR + ')...')
const reconP = agent([
  'You recon a software project at ' + ROOT + ' to set up a deep code review. A committed knowledge graph lives at ' + ROOT + '/' + GRAPH_DIR + ' (graph.json, GRAPH_REPORT.md, manifest.json).',
  'Produce THREE things:',
  '1. projectContext — a compact but information-dense English brief: tech stack & frameworks (read package.json / requirements.txt / go.mod / Cargo.toml / etc.), how the app is built/tested, and ALL project-specific conventions, design rules, security rules, and known bug patterns you can find in CLAUDE.md / AGENTS.md / README / docs/*. This string is injected into every reviewer; include the concrete gotchas that cause real bugs in THIS project.',
  '2. units — a partition of the codebase into review units sized so one agent can deeply read each (roughly 8-40 files per unit). Derive the partition from the graph communities in GRAPH_REPORT.md plus the directory tree. Every source file must fall in exactly one unit; split oversized dirs, merge tiny ones; group edge/serverless functions and backend separately from frontend; put framework/vendor primitives in a low-priority unit. Each unit: {key, label, scope (ripgrep-able paths/globs), kind}. Aim for 12-40 units; never exceed 40. Exclude node_modules/dist/build/vendor and the graph output dir.',
  '3. integrations + dbMode — list detected integrations/services; set dbMode to "supabase" if Supabase is used, else "sql-static" if there are SQL schema/migration files, else "none".',
  'Return via the structured tool. English.',
  SIGNALS_BLOCK,
].join('\n'), { label: 'recon', phase: 'Map', schema: RECON_SCHEMA }).catch(() => null)

const mineP = agent([
  'You analyze the committed knowledge graph at ' + ROOT + '/' + GRAPH_DIR + ' (graph.json, GRAPH_REPORT.md, .graphify_label_sigs.json if present, manifest.json).',
  'Produce review LEADS (not final findings): 1. deadCodeCandidates — source files that appear orphan / very low fan-in (use bash+jq over graph.json to find file nodes with no incoming import/call edges, excluding entrypoints/configs/tests/framework primitives; fall back to ripgrep sampling if jq parsing is hard). 2. duplicationCandidates — clusters of files/symbols with near-identical signatures or repeated names, each {files, note}. 3. hubFiles — highest fan-in files (cross-ref God Nodes in GRAPH_REPORT.md), high blast radius. Keep lists focused (<=60 dead-code, <=30 dup clusters). Structured tool. English.',
].join('\n'), { label: 'graph-mine', phase: 'Map', schema: MAP_SCHEMA }).catch(() => null)

const [recon, mapHints] = await Promise.all([reconP, mineP])

let units = (recon && recon.units && recon.units.length) ? recon.units.slice(0, 40) : [{ key: 'whole-repo', label: 'Whole repository', scope: ROOT, kind: 'mixed' }]
const projectContext = (recon && recon.projectContext) ? recon.projectContext : ('Project at ' + ROOT + '. No recon context available.')
const dbMode = (recon && recon.dbMode) ? recon.dbMode : 'none'
log('Recon: ' + units.length + ' review units · dbMode=' + dbMode)

phase('Review')
const GLOBALS = globalPasses(projectContext, mapHints, dbMode)

const verifyStage = (labelKey, label) => (rev) => {
  if (!rev || !rev.findings || rev.findings.length === 0) return { findings: [] }
  return agent(buildVerifierPrompt(label, projectContext, JSON.stringify(rev.findings)), { label: 'verify:' + labelKey, phase: 'Verify', schema: VERIFY_SCHEMA }).catch(() => null)
}

const unitResults = pipeline(
  units,
  (u) => agent(buildReviewerPrompt(u, projectContext), { label: 'review:' + u.key, phase: 'Review', schema: FINDINGS_SCHEMA }).catch(() => null),
  (rev, u) => verifyStage(u.key, u.label)(rev)
)
const globalResults = pipeline(
  GLOBALS,
  (g) => agent(g.prompt, { label: 'review:' + g.key, phase: 'Review', schema: FINDINGS_SCHEMA }).catch(() => null),
  (rev, g) => verifyStage(g.key, g.label)(rev)
)

const [unitsOut, globalsOut] = await Promise.all([unitResults, globalResults])

const confirmed = []
;[...unitsOut, ...globalsOut].filter(Boolean).forEach((r) => {
  if (r && r.findings) r.findings.forEach((f) => { if (f && f.confirmed !== false) confirmed.push(f) })
})
log('Confirmed findings after verification: ' + confirmed.length)

phase('Synthesize')
const byCat = {}
confirmed.forEach((f) => { const c = CATEGORIES.includes(f.category) ? f.category : 'maintainability'; (byCat[c] = byCat[c] || []).push(f) })
const presentCats = Object.keys(byCat)

const synthed = await parallel(presentCats.map((cat) => () =>
  agent([
    'You are a finding-synthesis editor. Below are verified code-review findings for category "' + cat + '".',
    'DEDUPLICATE (merge findings with the same root cause AT the same location; keep the union of detail and list all locations). Do NOT drop any DISTINCT issue. Order by severity (critical, high, medium, low, info) then confidence desc. Keep each finding compact and grounded. Return via the structured tool, same schema. English.',
    '', 'FINDINGS (JSON):', JSON.stringify(byCat[cat]),
  ].join('\n'), { label: 'synth:' + cat, phase: 'Synthesize', schema: FINDINGS_SCHEMA }).catch(() => null)
))

const finalFindings = []
synthed.filter(Boolean).forEach((r) => { if (r && r.findings) r.findings.forEach((f) => finalFindings.push(f)) })

const sevOrder = ['critical', 'high', 'medium', 'low', 'info']
const counts = {}
sevOrder.forEach((s) => { counts[s] = finalFindings.filter((f) => f.severity === s).length })
const catCounts = {}
CATEGORIES.forEach((c) => { const n = finalFindings.filter((f) => f.category === c).length; if (n) catCounts[c] = n })

log('Final deduped findings: ' + finalFindings.length + ' | severity ' + JSON.stringify(counts))

return { total: finalFindings.length, rawConfirmed: confirmed.length, unitCount: units.length, dbMode, counts, catCounts, findings: finalFindings }
