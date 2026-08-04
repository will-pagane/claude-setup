# Dispatch prompt templates — session-build

Used only when `N ≥ 2` specs. Dispatch all subagents of a step **in a single message** so they run concurrently.

Subagents inherit no conversation context. Every path, name and constraint must be written into the prompt verbatim. Each returns a short structured payload — never a narrative, never the plan text (it stays resident in the controller's context otherwise).

---

## § Plan writer (Step 1)

One per spec. Dispatch on a capable model — planning is a judgment task.

```
Write an implementation plan for one spec. You have no prior context; everything you need is below.

Repo root: <ABS_REPO_OR_WORKTREE_PATH>
Spec file: <ABS_SPEC_PATH>
Write the plan to: docs/superpowers/plans/<YYYY-MM-DD>-<spec-slug>.md

1. Invoke the `superpowers:writing-plans` skill and follow it exactly.
2. Read the spec file and the repo code it touches before writing anything.
3. Save the plan at the exact path above. Never write to a repo-root PLAN.md.
4. Run the skill's Self-Review section (spec coverage, placeholder scan, type consistency) and fix what it surfaces.
5. STOP THERE. Do NOT run the skill's "Execution Handoff" section, do not offer execution options, do not implement anything, do not commit.

Project constraints that bind this plan:
<PASTE THE PROJECT'S BINDING CONSTRAINTS VERBATIM — migration discipline (file-first + any required preflight block), permission/RLS rules, deploy/gate rules, collision/concurrency rules, lint/type rules, naming conventions>

Other specs are being planned in parallel by other agents. If your spec depends on one of them, note the dependency in the plan's Global Constraints; do not try to plan their work.

Return exactly these lines and nothing else:
PLAN: <path>
TASKS: <number of tasks>
GAPS: <one line per spec requirement you could not turn into a task, or "none">
```

---

## § Codex reviewer (Step 2)

One per plan. Runs the adversarial loop and — critically — copies the converged plan back.

```
Harden one implementation plan through the codex-review adversarial loop. You have no prior context.

Repo root: <ABS_REPO_OR_WORKTREE_PATH>
Plan file: docs/superpowers/plans/<YYYY-MM-DD>-<spec-slug>.md
Source spec (for grounding): <ABS_SPEC_PATH>

1. Invoke the `codex-review` skill with slug=<spec-slug> and follow it exactly. The unique slug keeps your run dir from colliding with the reviews running in parallel right now.
2. Seed the loop with the EXISTING plan above — copy it into $PLAN_FILE. Do not re-plan from scratch.
3. Run the loop to VERDICT: APPROVED or MAX_ROUNDS, revising the plan yourself between rounds.
4. MANDATORY LAST STEP: copy the converged $PLAN_FILE back over docs/superpowers/plans/<YYYY-MM-DD>-<spec-slug>.md. The hardened plan is worthless if it stays in the run dir — implementation reads only the docs/superpowers/plans/ path.
5. Do NOT implement anything. Do NOT commit. Read-only on source code; the only file you write outside your run dir is the plan file in step 4.

Project constraints the plan must satisfy:
<PASTE THE PROJECT'S BINDING CONSTRAINTS VERBATIM>

Return exactly these lines and nothing else:
PLAN: <path>
VERDICT: APPROVED | REVISE
ROUNDS: <n>
RUN_DIR: <path>
OPEN: <one line per finding still unresolved at the end, or "none">
COPIED_BACK: yes | no
```

If a reviewer returns `COPIED_BACK: no`, do the copy yourself before Step 3 — or the branch implements the un-hardened plan.

---

## Verification the controller owes after each fan-out

- Step 1: every promised plan file exists and is non-trivial; `GAPS` triaged.
- Step 2: every plan file's content actually changed (or the reviewer approved round 0 with no revisions — confirm, don't assume); every `OPEN` finding either resolved or escalated to the user before implementation starts.
