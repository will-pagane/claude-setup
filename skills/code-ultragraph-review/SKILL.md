---
name: code-ultragraph-review
description: Use when the user asks for an extensive, maximum-quality, whole-codebase review or audit and wants a consolidated findings report (read-only, default). Add `--autopilot` to run a fully autonomous performance pipeline: read Supabase signals, deep-dive via dynamic workflows, refine fixes with a headless Codex pass, apply fixes (parallel workflow + subagent-driven-development), verify with auto-repair, and open a Pull Request. Requires a committed knowledge graph (graphify). Always runs the review as a multi-agent ultracode workflow, never inline.
---

# Code Ultragraph Review

## Overview
A deep, whole-codebase review is too large for one context to do well. This skill runs it as a **graph-informed, multi-agent ultracode workflow**: the committed knowledge graph partitions the codebase and surfaces hotspots; dozens of subagents review slices across every finding class; each finding is **adversarially verified** before it survives; results are deduped and severity-ranked into one report.

**Two hard rules:**
1. **No graph → no run.** This skill only operates on a project that already has a committed knowledge graph.
2. **Always ultracode.** The review MUST run via the **Workflow** tool. Never do it inline, and never with ad-hoc `Agent` teammates — defaulting to a handful of inline teammates is the exact failure mode this skill exists to prevent.

## Invocation & modes
- `/code-ultragraph-review <category>` → read-only review (current behavior). Writes a report, stops.
- `/code-ultragraph-review <category> --autopilot` → fully autonomous WRITE pipeline, category-driven by `lib/categories.mjs`: worktree → runtime signals (skipped when the mission has no signal provider) → deep-dive workflow → report → headless Codex refine → classify → apply (parallel + SDD) → verify+auto-repair → Pull Request. NO human gates. Opt-in only; without `--autopilot` the skill never writes.
- Supported missions (the `<category>` arg): `performance`, `security`, `correctness`, `cleanup`, `code-health`. Each is one entry in `lib/categories.mjs` (`includeCategories`, `signals`, `branchPrefix`, `prTitlePrefix`). Adding a mission = adding one registry entry. Default `<category>` is `performance`.

Resolve `<category>` (default `performance`) and the `--autopilot` flag from the skill args first. Record the skill's base directory (reported on load) — every script below is referenced relative to it as `<BASE>`.

## Activation gate (do this FIRST)
Detect a knowledge graph — look for `graphify-out/`, `.graphify/`, or any directory holding both `graph.json` and `GRAPH_REPORT.md`:

```bash
ls graphify-out/graph.json .graphify/graph.json 2>/dev/null; \
find . -maxdepth 3 -name graph.json -not -path '*/node_modules/*' 2>/dev/null | head
```

- **Found** → capture its directory and proceed.
- **Not found** → STOP. Tell the user: *"No knowledge graph found. Generate one first with `/graphify`, then re-run this review."* Do not fall back to a manual or inline review.

## Process
1. **Gate** — confirm a graph exists (above). Record the graph directory and the absolute repo root (`pwd`).
2. **Launch the workflow** — invoke the **Workflow** tool with `scriptPath` pointing at this skill's bundled script and `args` carrying the repo root + graph dir:
   - `scriptPath`: `<this skill's base directory>/review-workflow.js` — the Skill tool reports the base directory when this skill loads; use that absolute path.
   - `args`: `{ "root": "<absolute repo root>", "graphDir": "<graph directory>" }`
   The script self-discovers the stack, project conventions, integrations, and a review-unit partition from the graph. **Do not hardcode anything** or edit the script per project — keep it generic.
3. **Render the report** — when the workflow returns its structured `findings`, write ONE markdown file at `docs/code-review-<YYYY-MM-DD>.md` (or `./code-review-<YYYY-MM-DD>.md` if there is no `docs/`). Use the format below, rendering deterministically from the returned fields. Do not summarize findings away.
4. **Brief the user** — post a short summary: counts by severity + by category, with every Critical/High finding called out explicitly.

## Autopilot pipeline (only when `--autopilot` is present)

**Autopilot is headless (every category).** For ANY `<category>`, when `--autopilot` is present the run is FULLY HEADLESS: a routine fires it inside a `<scheduled-task>` wrapper and no human is present to answer. Never call `AskUserQuestion`. Never invoke a sub-skill or tool in a mode that prompts for consent or interactive input (the worktree consent is already pre-declared in Phase 1 to avoid hanging, keep that). Any blocker that would otherwise require a human decision: log it and either abort cleanly or open the PR as `--draft`. Never end the turn waiting for chat input. This applies uniformly across all categories driven by `lib/categories.mjs` (performance, security, correctness, cleanup, code-health).

Run these phases IN ORDER from the main thread. Each phase is a Workflow call, a Skill invocation, or direct tool/MCP use. NEVER call a Skill from inside a Workflow script.

**Phase 0 — Gate.** Run the graph gate (above). No graph → STOP, route to `/graphify`. Record absolute repo root and graph dir.

**Phase 1 — Worktree.** Compute ONE run stamp first and reuse it for every name below: `TS=$(date +%Y-%m-%d-%H%M)`. Then invoke `superpowers:using-git-worktrees` passing an EXPLICITLY DECLARED worktree directory and branch, so it neither asks for consent (which would hang a headless run) nor lets a native worktree tool auto-pick a non-deterministic directory name:
- worktree directory: `.worktrees/code-ultragraph-review/<category>-<TS>`
- branch: `<branchPrefix>/<TS>` where `<branchPrefix>` = `CATEGORY_REGISTRY[<category>].branchPrefix` (e.g. `ultragraph/perf`, `ultragraph/security`, `ultragraph/correctness`, `ultragraph/cleanup`, `ultragraph/health`)
Ensure `.worktrees/` is gitignored (add it to `.gitignore` or `.git/info/exclude` if missing). The `<category>-<TS>` stamp keeps every run unique, so distinct missions and same-day re-runs never collide. All subsequent writes happen in this worktree (referred to below as `<wt>`). Create `<wt>/.ultragraph-review/` for intermediate artifacts and add it to `.git/info/exclude`.

**Liveness guard (mandatory).** This pipeline parks the main thread while background Workflows run. If you ever receive a system reminder that the worktree was deleted or reset, or that a Workflow host was torn down, STOP the run immediately with a logged error instead of waiting: a deleted host leaves background agents that never settle, which otherwise hangs the run for hours. Never wait silently on a Workflow whose host no longer exists.

**Phase 2 · Runtime signals (main thread, MCP). Category-driven.** Resolve `SIG = CATEGORY_REGISTRY[<category>].signals`. If `SIG === null` (e.g. `cleanup`, `code-health`), SKIP this phase: write `{advisors:[],postgresLogs:[],edgeLogs:[],authLogs:[],window:"24h"}` to `<wt>/.ultragraph-review/raw-signals.json` and `{signals:[]}` to `<wt>/.ultragraph-review/perf-signals.json`, then go to Phase 3. Otherwise load the Supabase MCP tools via ToolSearch (`select:mcp__supabase__get_advisors,mcp__supabase__get_logs`; fallback prefix `mcp__claude_ai_Supabase__`). For each type in `SIG.advisorTypes` call `get_advisors(type=<that>)`; for each service in `SIG.logServices` call `get_logs(service=<that>)` (service `postgres` → `postgresLogs`, `edge-function` → `edgeLogs`, `auth` → `authLogs`). Write the raw payloads to `<wt>/.ultragraph-review/raw-signals.json` as `{advisors, postgresLogs, edgeLogs, authLogs, window:"24h"}`, then run `node <BASE>/lib/normalize-signals.mjs <wt>/.ultragraph-review/raw-signals.json <category> > <wt>/.ultragraph-review/perf-signals.json` (the `<category>` arg selects the mission's log regex). If MCP is unreachable, write empty arrays and continue.

**Phase 3 — Deep-dive (Workflow #1).** Invoke the Workflow tool with `scriptPath: <BASE>/review-workflow.js` and `args: { root: "<repo root>", graphDir: "<graph dir>", signals: <contents of perf-signals.json> }`. It returns structured `findings`.

**Phase 4 · Report + filter. Category-driven.** Write the full report to `docs/code-review-<category>-<date>.md` (existing format). Resolve `INC = CATEGORY_REGISTRY[<category>].includeCategories` and `DBI = CATEGORY_REGISTRY[<category>].dbImpact`. Keep a confirmed finding iff `finding.category ∈ INC`, OR (`finding.category === 'db_integrity'` AND `DBI !== null` AND the finding impact matches `DBI`: route a db_integrity finding to `security` when its `current_impact`/`context` is about access/RLS/permission/secret, and to `performance` when about index/scan/lock/latency). Write the filtered set to `<wt>/.ultragraph-review/findings.json`.

**Phase 5 — Build fix-set + headless Codex refine.** First convert findings to a fix-set: dispatch ONE `Agent` (general-purpose) that reads `findings.json` and the report and emits `<wt>/.ultragraph-review/fixes.json`, an array of `{ id, title, location, files:[paths], kind:"mechanical"|"complex", dependsOn:[ids], proposed_solution, patchHint }`. Then render it as `<wt>/.ultragraph-review/PLAN.md` (goal + per-fix bullets). Run the headless Codex loop (no gates):
  1. `THREAD_ID` from `bash <BASE>/lib/codex-refine.sh init <wt>/.ultragraph-review/PLAN.md /tmp/codex-verdict.txt <category>`.
  2. Read `/tmp/codex-verdict.txt`; append to `PLAN-REVIEW-LOG.md`. If it ends `VERDICT: APPROVED` → done. If `VERDICT: REVISE` → you (Claude) revise `fixes.json`/`PLAN.md` incorporating the valid critiques (you are the arbiter; log what you rejected and why), then `bash <BASE>/lib/codex-refine.sh resume "$THREAD_ID" /tmp/codex-verdict.txt` and repeat.
  3. Stop at `VERDICT: APPROVED` or after `MAX_ROUNDS=3`. If `codex-refine.sh` exits non-zero (Codex unavailable), log it, skip refine, proceed with the current `fixes.json`.

**Phase 6 — Classify.** Run `node <BASE>/lib/classify-fixes.mjs <wt>/.ultragraph-review/fixes.json > <wt>/.ultragraph-review/buckets.json` → `{ mechanicalIsolated, complexCoupled }`.

**Phase 7 — Apply parallel (Workflow #2).** Invoke the Workflow tool with `scriptPath: <BASE>/apply-workflow.js` and `args: { root: "<wt>", category: "<category>", fixes: <buckets.mechanicalIsolated> }`. Save the returned `results` to `<wt>/.ultragraph-review/apply-results.json`.

**Phase 8 — Apply complex (SDD).** If `buckets.complexCoupled` is non-empty, invoke `superpowers:subagent-driven-development`, treating each coupled fix (in the given dependency order) as a task: TDD where a test is meaningful, two-stage review per fix. After all tasks complete, write `<wt>/.ultragraph-review/sdd-results.json` as a JSON array of `{ id, title, status: "applied"|"failed", filesTouched: [paths], note }` — one entry per complexCoupled fix (`status: "applied"` if the task passed two-stage review, `"failed"` otherwise). This mirrors `apply-results.json` so Phase 10 can join both arrays mechanically.

**Phase 9 — Verify + auto-repair.** Compute touched edge-function paths into `<wt>/.ultragraph-review/edge-touched.txt` via `git -C <wt> diff --name-only <merge-base>..HEAD | grep '^supabase/functions/' | xargs -I{} dirname {} | sort -u` (this captures BOTH the parallel and SDD apply paths). Run `bash <BASE>/lib/verify.sh <wt> <wt>/.ultragraph-review/edge-touched.txt > <wt>/.ultragraph-review/verify-result.json`. If `passed:false`, run a focused repair (a small Workflow or SDD pass that reads the failing check logs in `/tmp/verify-*.log` and fixes them) and re-run verify. Repeat up to 2 attempts.

**Phase 10 — Pull Request.** Stage and commit on the worktree branch. Assemble `<wt>/.ultragraph-review/pr-input.json` as `{ date, category, reportPath, findings, applied, notApplied, codex, verification }` (set `category` to the resolved `<category>`) where:
- `findings` = contents of `findings.json` (the category-filtered set from Phase 4).
- `applied` = (from `apply-results.json` where `status==='applied'` → `{id, title, via:'parallel'}`) concatenated with (from `sdd-results.json` where `status==='applied'` → `{id, title, via:'sdd'}`).
- `notApplied` = (from both `apply-results.json` and `sdd-results.json` where `status==='failed'` → `{id, title, reason: note}`).
- `codex` = `{ rounds: <n from the refine loop>, verdict: <'APPROVED'|'REVISE'|'skipped'> }` ('skipped' if Codex was unavailable).
- `verification` = contents of `verify-result.json`.

Then run `node <BASE>/lib/pr-body.mjs <wt>/.ultragraph-review/pr-input.json > <wt>/.ultragraph-review/pr-body.md`. Push the branch and `gh pr create --base main --head <branchPrefix>/<TS> --title "<prTitlePrefix>: autopilot review <date>" --body-file <wt>/.ultragraph-review/pr-body.md` (add `--draft` when `verify-result.json` has `passed:false`), where `<branchPrefix>`/`<prTitlePrefix>` come from `CATEGORY_REGISTRY[<category>]`. The `<wt>` branch is `<branchPrefix>/<TS>` from Phase 1. Report the PR URL to the user.

## Report format (compact, per finding)
Top of file: a summary table (counts by severity, and by category, plus how many raw findings were verified vs. dropped). Then findings grouped by severity (Critical → Info), each rendered as:

```
### [SEVERITY] · <category> · <title>
`path/to/file.ext:line`  · confidence <0–1>
- **Problem:** <minimal context to locate + understand>
- **Solution:** <concrete fix>
- **Current impact:** <negative effect right now>
```

Keep every distinct finding; merge only true duplicates (same root cause AND same location).

## What the workflow does (reference)
`review-workflow.js` orchestrates four phases:
- **Map** — one agent recons the project (stack, documented conventions, project-specific bug sources, integrations) and produces a **review-unit partition** derived from the graph's communities + directory tree; a second agent mines the graph for dead-code / duplication / hub-file candidates.
- **Review + Verify** — a reviewer per unit inspects all finding classes (grounded in `file:line` + a real snippet); each reviewer is immediately followed by an **adversarial verifier** that re-reads the code and refutes false positives. Cross-cutting global passes (dead-code, duplication, conventions, missing-impl, security) and, when a database is detected, DB passes (advisors + RLS/RPC/index review) run the same find→verify shape. Both reviewers and verifiers apply **fix-safety good practices** so the report's `Solution` does not trade one bug for another — most importantly: an authz/permission gate must be keyed to the function's ACTUAL callers (not a topically-related slug), and a `search_path` hardening fix must preserve cross-schema resolution (include `extensions` / fully-qualify when the body calls pgcrypto/uuid/pgsodium/vault unqualified — a bare `public, pg_temp` breaks them at call time).
- **Synthesize** — dedup per category, severity-rank, return structured findings.

Finding classes: `duplication`, `dead_code`, `unifiable`, `incomplete_impl`, `performance`, `security`, `type_safety`, `error_handling`, `correctness`, `convention`, `db_integrity`, `accessibility`, `maintainability`.

## Red flags — STOP
- "I'll just review it inline / with a few teammates." → No. Use the **Workflow** tool.
- "No graph, but I'll proceed anyway." → No. Stop and route the user to `/graphify`.
- "I'll return findings inline instead of writing the file." → No. Always write the report file.
- "I'll trust the reviewers without verification." → The verify stage is mandatory; never strip it.
- "Let me tailor the script to this project's specifics." → No. The recon agent derives specifics at runtime; the script stays generic.
- "I'll call codex-review / subagent-driven-development from inside the Workflow script." → No. Skills compose at the main-thread level, BETWEEN Workflow calls.
- "Codex resume with -s read-only." → No. resume rejects -s; force `-c sandbox_mode="read-only"` (codex-refine.sh already does).
- "Verification is red but I'll open a normal PR." → No. Open it as `--draft` with failures documented.
- "I'll apply fixes on main / outside the worktree." → No. All writes live on the `<branchPrefix>/<TS>` branch from Phase 1.
- "Autopilot without --autopilot because the user named a category." → No. Writes require the explicit flag, for every mission.

## Common mistakes
| Mistake | Fix |
|---|---|
| Hardcoding project specifics in the script | The recon agent derives stack/conventions/units/integrations at runtime |
| Skipping the graph gate | Without a graph the partition is blind; generate it first |
| One giant reviewer over the whole repo | Partition into units; depth per slice is the point |
| Dropping findings during dedup | Merge only same-root-cause + same-location; never silently drop distinct issues |
| Forgetting to write the report file | Always emit `code-review-<date>.md` |
| Recommending a fix that itself regresses | Apply fix-safety: tie authz gates to real callers; preserve cross-schema resolution when hardening `search_path`; pressure-test the remedy against how the code is actually invoked |
