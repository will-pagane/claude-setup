---
name: session-build
description: Use when one or more spec files exist (typically written earlier in this session) and the user asks to take them all the way to shipped — "/session-build", "builda essas specs", "pega essas 3 specs e implementa", "roda o session build", "leva esses specs até o merge", "implementa os specs e abre o PR". Not for an ad-hoc code change with no spec, and not for writing a spec.
---

# Session Build

Spec(s) in → pushed, verified branch + review checklist out, in one continuous pass. Opening a PR and merging are **not** part of that pass — they happen only when the user explicitly asks.

**Announce at start:** "Using session-build to take <N> spec(s) from plan to a pushed branch."

## Authorization

The invocation authorizes, **for the specs in scope only**: branch/worktree creation, commits, applying migrations, deploying edge functions, and pushing the branch. Nothing outside those specs is authorized.

**PR and merge are NOT authorized by default.** The default terminal state is a pushed, verified branch with the checklist printed. Open a pull request or merge **only when the user explicitly asks for it** — either in the invoking request ("...e abre o PR", "leva até o merge") or in a later message. Absent an explicit ask, stop at the pushed branch and report; never open a PR or merge "to be helpful".

Human gates — only these:
1. **Step 0** — confirm the spec list and the execution order.
2. **Escalations** — any plan contradiction, BLOCKED task, or red verification.
3. Nothing else. Do **not** ask "should I continue?" between steps. Run 0→6 straight through to the pushed branch.

If (and only if) PR/merge was explicitly requested, the merge is still hard-gated: red lint/build/test, an unresolved load-bearing review finding, or an unapplied migration → **stop and report**, never merge anyway.

## Project gates and conventions

This skill runs inside real projects that carry their own rules. Read the project's `CLAUDE.md`/`AGENTS.md` at Step 0 and obey it over any default here. Concretely:

- **Never bypass a gate.** If the project has pre-commit/pre-push hooks (migration checks, collision detection, ledger, branch policy), let them run — never `--no-verify`, never `--force`. A gate that fails is an escalation, not an obstacle.
- **Concurrency.** When several sessions share one database or deploy runtime, run the project's collision check (e.g. `npm run collide`) before touching a shared backend surface, and give each session its own branch + worktree.
- **Merge strategy follows the project.** If the project preserves commit history, merge with `--merge` (or fast-forward) — **never `--squash`** unless the project explicitly asks for it.
- **Deploy through the project's wrapper.** If the project ships a deploy script/gate (e.g. `scripts/sb-deploy.sh`), use it — never a bare `supabase functions deploy` that skips the gate.
- **Migrations follow the project's discipline** — file-first via the migration CLI, any redefinition of an existing object carries the project's required preflight evidence, committed with the code that needs it.

## Fan-out rule

`N` = number of specs in scope.

| Step | N = 1 | N ≥ 2 |
|------|-------|-------|
| 1 — write plan | inline, in this session | **one subagent per spec, dispatched in parallel** |
| 2 — codex-review the plan | inline, in this session | **one subagent per plan, dispatched in parallel** |
| 3 — implement | sequential (subagent-driven-development) | sequential, **one plan at a time, never two in parallel** |
| 4–6 | inline | inline |

Steps 1 and 2 are the only parallel ones. Implementation is always serial — parallel implementers on one branch conflict.

## Step 0 — Scope and isolation

1. **Identify the specs.** If the user named files, use exactly those. Otherwise list the candidates (new/modified spec files in this session, e.g. under `docs/**/specs/`) and ask in one message which to build. Do not guess.
2. **Execution order.** If any spec depends on another (shared schema, shared module, one consumes the other's API), state the dependency in plain prose and propose an order; ask only if genuinely ambiguous. Independent specs run in the listed order.
3. **Isolate.** Use `superpowers:using-git-worktrees`. Branch `<type>/<combined-slug>-<YYYYMMDD>`, worktree `.claude/worktrees/<combined-slug>-<YYYYMMDD>`. Never build on `main`/`master`. If already inside a worktree created for this work, reuse it.
4. **Create the ledger** (see Ledger below) and one todo per step per spec.

## Step 1 — Plan per spec `*`

Each spec becomes exactly one plan at `docs/superpowers/plans/YYYY-MM-DD-<spec-slug>.md`, written with `superpowers:writing-plans`.

- N = 1: run `superpowers:writing-plans` inline.
- N ≥ 2: dispatch one subagent per spec **in a single message** so they run concurrently. Prompt template: [dispatch-prompts.md](dispatch-prompts.md) § Plan writer.

**Never** write plans to a repo-root `PLAN.md` — concurrent sessions collide there.
Planners must **not** ask the writing-plans execution-handoff question; the controller owns execution. They return the plan path and nothing else.

Record each plan path in the ledger before moving on.

## Step 2 — Codex review per plan `*`

Each plan goes through the `codex-review` adversarial loop until `VERDICT: APPROVED` or `MAX_ROUNDS`.

- N = 1: run `codex-review` inline with `slug=<spec-slug>`.
- N ≥ 2: one subagent per plan, dispatched in a single message. Template: [dispatch-prompts.md](dispatch-prompts.md) § Codex reviewer.

**The critical wiring:** codex-review works inside its own `$RUN_DIR/PLAN.md`. When the loop converges, the hardened plan **must be copied back over** `docs/superpowers/plans/<...>.md`. Skip this and Step 3 silently implements the un-hardened plan. Verify each plan file's mtime/content changed before Step 3.

Each reviewer returns: plan path, verdict, round count, run dir, and any finding it could not resolve. Log all five in the ledger. A `REVISE` at the cap is an escalation — surface the open findings to the user before implementing.

## Step 3 — Sequential implementation

For each plan, in the confirmed order, run `superpowers:subagent-driven-development` to completion, then move to the next plan.

- The controller does not write code. It dispatches, reviews, adjudicates.
- **Override SDD's ending:** SDD finishes by calling `superpowers:finishing-a-development-branch`. Do **not** run it per plan, and do **not** let it open a PR or merge. This skill's Step 5 (verify + push) replaces it, once, after the last plan; PR/merge is out of the default flow.
- After each plan: append `Spec <slug>: implemented (commits <a7>..<b7>)` plus its deferred/parked findings to the ledger. Those findings feed Step 6.
- A BLOCKED task that SDD cannot resolve stops the run — report to the user with the finding, the plan text, and the fix history.

## Step 4 — Migrations and deploys

Implementation frequently leaves these undone. Verify explicitly; do not assume.

0. **Collision check.** If the project shares a database/runtime across sessions, run its collision gate (e.g. `npm run collide`) before applying anything. An unresolved collision is an escalation.
1. **Migrations** — list migration files added on this branch (`git diff --name-only <base>...HEAD -- '*migrations*'`) and confirm each is applied (`supabase db push`, or the project's equivalent), honoring the project's migration discipline (file-first, required preflight evidence). Regenerate the generated types file if the schema changed.
2. **Edge functions / serverless** — for every function whose source changed on this branch, deploy it **through the project's deploy wrapper if one exists** (e.g. `scripts/sb-deploy.sh`), else `supabase functions deploy <name>`, preserving `verify_jwt` settings, and **verify by re-downloading and grepping for the change**. A version bump alone is not proof. Changing a shared module means redeploying every consumer. Run the project's drift check (e.g. `npm run drift`) after deploying.
3. Anything else the plan declares as a deploy step.

Record in the ledger what was applied vs. already applied.

## Step 5 — Verify and push

1. **Verification, run by the controller** (subagents cannot vouch for the whole branch): the project's full lint, typecheck, build, and test suite. Read the actual output. Red → stop, fix, re-run.
2. `git push -u origin <branch>` (never force-push).

**This is the default terminal state: a verified, pushed branch.** Print the Step 6 checklist and stop here. Do **not** open a PR and do **not** merge unless the user explicitly asked — see "On request: PR and merge" below.

## Step 6 — Checklist

Compose from the ledger (never from memory) and print inline, in the user's language:

- **Entregue** — one line per spec: what shipped, commit range (PR number only if one was opened).
- **Aplicado em produção** — migrations applied, functions deployed + how each was verified.
- **Você precisa revisar** — everything a human must check: visual/UX verification, live e2e, external config (panel keys, webhook URLs, permission seeds), and anything only observable in production.
- **Adiado / parked** — every deferred minor and parked finding from the SDD ledgers, with the ruling.
- **Não feito** — anything in a spec that was cut, and why.
- **Próximo passo** — state plainly that the branch is pushed and awaits your call on PR/merge (unless PR/merge was already requested and done).

The ledger file path stays as the durable copy.

## On request: PR and merge

Do this **only** when the user explicitly asked for a PR and/or a merge — in the invoking request or in a later message. Never as a default, never "to be helpful". Opening a PR is itself an outward action gated on that ask; merging is a further, separate ask.

**Open the PR** (when a PR was asked for):
- `gh pr create` with a body that IS the Step 6 checklist (so it persists in GitHub). Include the harness-required attribution footer if the project uses one.
- If the ask stopped at "open a PR", stop here — do not merge.

**Merge** (only when the user asked to merge, and only after PR verification is green):
- Re-verify the merge is not hard-gated (red lint/build/test, unresolved load-bearing finding, unapplied migration) before proceeding.
- Merge with the project's history policy — `gh pr merge --merge` when history is preserved, **never `--squash`** unless the project asks for it. Do not pass `--delete-branch` while the worktree still has the branch checked out.
- Never force-push, never merge with a dirty tree, never merge a red branch.

**Post-merge cleanup** (only after an actual merge):
- From outside the worktree: `git worktree remove <dir>`, delete the local branch, delete the remote branch, then `git pull origin main` on the main checkout so it reflects the merge. Confirm `git worktree list` no longer shows it.
- If the project's hosting redeploys on push and that redeploy is unreliable (or reverts branch deploys), **re-deploy the changed functions through the project's wrapper** and re-run the drift check — a branch deploy from Step 4 does not survive the merge.
- If the generated types file merges `ours`, regenerate it (e.g. `npm run types`) so it reflects the merged schema.

## Ledger

`.superpowers/session-build/<YYYYMMDD-HHMM>/ledger.md`, first line `# session-build — specs: <list>`. Append after every step: spec → plan path → verdict → commit range → deploy state → findings. Context does not survive compaction; the ledger does. On resume, trust the ledger and `git log` over recollection, and restart at the first step without a completion line.

## Common mistakes

| Mistake | Reality |
|---|---|
| "Parallel implementers are faster" | They conflict on one branch. Step 3 is serial. Always. |
| "The plan is in the codex run dir, close enough" | Step 3 reads `docs/superpowers/plans/`. Copy the converged plan back or you ship the un-hardened one. |
| "SDD said to finish the branch" | Only after the LAST plan. Step 5 (verify + push) replaces it, once — it does not open a PR or merge. |
| "The invocation said build, so I'll open the PR/merge too" | PR and merge need an explicit ask. Default stops at a pushed branch. |
| "Push triggers the deploy" | Verify by re-downloading the deployed function. Bulk redeploys silently fail. |
| "Tests passed in the subagent's report" | The controller runs the full suite before push. Nothing else counts. |
| "I'll ask before each step" | Two gates only: scope, and escalations. Otherwise run straight through to push. |
| "Checklist from memory" | Compose it from the ledger. Parked findings are invisible to a compacted context. |

## Red flags — stop

- About to open a PR or merge without an explicit request from the user.
- About to merge with red lint/build/tests, or an unapplied migration.
- About to `git commit` on `main`/`master`.
- About to `--squash` a project that preserves history, or slip `--no-verify`/`--force` past a gate.
- A plan file unchanged after its codex-review returned APPROVED.
- Two implementer subagents live at once.
- A spec in the confirmed scope with no plan, or a plan with no implementation.
