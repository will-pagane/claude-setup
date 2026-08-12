---
name: session-build
description: Use when the user wants an idea taken from conversation to implemented, pushed branches in one continuous pass — "/session-build <ideia>", "builda isso", "brainstorma e implementa", "roda o session build", "pega essa ideia e leva até a branch pronta". Starts with a brainstorm that produces one or more specs; one spec runs inline, several fork this session into one child session per spec with this session orchestrating them. Stops at pushed branches — never opens a PR, never merges (that is /session-end). Not for a spec-less one-line code change.
---

# Session Build

Idea in → one or more verified, pushed branches out, in one continuous pass.

Pipeline: **brainstorm → spec(s) → plan → codex-review → subagent-driven implementation → verified push.**
Migrations and deploys are **tasks inside the plan**, not a separate phase.
Pull request and merge are **not part of this skill at all** — `/session-end` owns them, run by the user after their own verification.

**Announce at start:** "Using session-build to take this idea from brainstorm to pushed branch(es)."

## Entry points

| Invocation | Start at |
|---|---|
| `/session-build <prompt>` | Step 1 — the prompt seeds the brainstorm |
| `/session-build` with no prompt, and spec files already written this session | Step 2 — confirm which specs are in scope, skip the brainstorm |
| `/session-build` with no prompt and no specs | Ask for the idea in one message, then Step 1 |

**This is not fire-and-forget until Step 2 closes.** Step 1 runs `superpowers:brainstorming`, which holds a hard gate on the user approving the design and reviewing each spec, and Step 2 ends on the user confirming scope, order and collision rulings. A run launched and walked away from parks at the first question — correctly, but silently. Everything after that confirmation is autonomous.

## Authorization

The invocation authorizes, **for the specs it produces only**: brainstorming, writing spec files, branch/worktree creation, forking this session, commits, applying migrations, deploying edge functions, and pushing branches.

**Not authorized, ever, under this skill:** `gh pr create`, any merge, any force-push, any deletion of a branch or worktree, and any work outside the specs in scope. If the user asks for a PR mid-run, answer that `/session-end` is the skill for it and keep going.

Human gates — only these:
1. **Brainstorm gates** — the ones `superpowers:brainstorming` owns (design approval, spec review). Those are the user's.
2. **Step 2** — confirm the spec list, the execution order and the dependency rulings.
3. **Escalations** — plan contradiction, BLOCKED task, red verification, unresolvable collision, a silent fork.
4. Nothing else. Do **not** ask "should I continue?" between steps.

## Project gates and conventions

This skill runs inside real projects that carry their own rules. Read the project's `CLAUDE.md`/`AGENTS.md` at Step 2 and obey it over any default here. Concretely:

- **Never bypass a gate.** Pre-commit/pre-push hooks (migration checks, collision detection, ledger, branch policy) run — never `--no-verify`, never `--force`. A failing gate is an escalation, not an obstacle.
- **Deploy through the project's wrapper** (e.g. `scripts/sb-deploy.sh`), never a bare deploy command that skips the gate.
- **Migrations follow the project's discipline** — file-first via the migration CLI, required preflight evidence on any redefinition, committed with the code that needs it.
- **Generated/hook-owned files** are not committed on a branch when the project forbids it.
- **Docs policy.** Specs are docs. If the project routes docs straight to the default branch, commit them there — not on a feature branch.

## Topology

`N` = number of specs the brainstorm produced.

| | N = 1 | N ≥ 2 |
|---|---|---|
| Who builds | this session, inline | one **fork of this session** per spec |
| This session's role | builder | **orchestrator only — writes no code** |
| Branches / worktrees | one | **one per spec** |
| Plan + codex-review | inline | inside each fork, concurrent |
| Implementation | inline, via SDD | inline **inside each fork** (no SDD — see below), concurrent across specs, serial within one |
| Terminal state | 1 pushed branch | N pushed branches |

A fork inherits this session's full conversation context — the whole brainstorm, every spec, every ruling. That is the point: forks already know why their spec exists and what the neighbours are doing. The fork prompt gives **directives**, not a context dump.

## Step 1 — Brainstorm to spec(s)

Run `superpowers:brainstorming` with the user's prompt, following it exactly, including its gates.

Two overrides on that skill:

- **Its terminal state is invoking `writing-plans`. Ignore that.** Return here instead — Step 4 owns planning, and for `N ≥ 2` planning happens inside the forks.
- **Decomposition produces the spec set.** When the idea is too large for one spec, brainstorming decomposes it into sub-projects. Brainstorm **every** sub-project to its own spec file before leaving Step 1 — do not build the first and defer the rest. That decomposition is exactly what makes `N ≥ 2`.

Specs land at `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (or the project's spec location) and are committed per the project's docs policy.

**Push the spec commit before Step 3** if the project's worktrees branch from the remote default branch — otherwise a fresh worktree will not contain the spec its fork is supposed to read.

## Step 2 — Scope, dependencies, collision plan

This is the orchestration design. Do it before any branch exists.

1. **Confirm the spec list** in one message. If the user named files, use exactly those.
2. **Dependency graph.** For each ordered pair, classify in plain prose. **Every tier keeps its own branch and its own worktree — two sessions never share a working directory.** A dependency is temporal, not spatial: a fork that needs another's code cannot implement before that code exists, so sharing a directory buys parallelism the dependency itself forbids, while importing `index.lock` contention, verification that reads a neighbour's half-written files, and working-tree gates that fail on someone else's breakage.
   - **Independent** — no shared surface. Fully parallel.
   - **Soft** — B needs to *know* A's interface but does not need A's code to run. Both branch from the default branch; the orchestrator relays the interface decision.
   - **Partial** — only some of B's tasks need A's code. B branches from the default branch and **orders its plan so every dependency-free task runs first**, with the dependent tasks behind a single merge point. When A reports `PUSHED`, the orchestrator sends `MERGE <A-branch> BEFORE <task>`. This is the common case and the one that pays: B builds while A builds, instead of idling.
   - **Total** — B imports A's code wholesale, or B's migration assumes A's schema, and almost nothing in B stands alone. **B's branch is created from A's branch**, after A reports `PUSHED` — so integration costs nothing, there is no merge to save. B still plans and codex-reviews in parallel, from the default branch, while it waits.
   - **Entangled** — the two would have to edit the same code at the same time to make sense of each other. That is not a dependency, it is a decomposition error: **fold them back into one spec** with one fork, which implements them serially. Two agents in one working directory is never the answer.

   **The graph must be acyclic.** Walk it and say so explicitly. Any cycle — A needs B and B needs A, directly or through a third spec — is `Entangled` by definition: fold the cycle's members into one spec. A cycle left in the graph deadlocks the run, and it deadlocks it *late*, after both forks have already planned and built.
3. **Surface pre-scan.** From the specs alone, list per spec: tables and migrations, edge/serverless functions, shared modules, frontend routes/hooks. Intersect them. Every non-empty intersection gets a written ruling now:
   - **Same edge function in two specs** → assign it to exactly one fork. The other fork's change to that function either moves into the owner's plan, or waits for the owner to push and then merges the owner's branch before touching it. Two forks deploying the same function from different branches means the second deploy silently reverts the first.
   - **Same table in two migrations** → order them. The later one is written against the earlier one's schema, and is applied only after the earlier is confirmed applied.
   - **Same source file** → prefer moving the change into one spec's plan. If genuinely both, order them and make the second fork merge the first's branch.
4. **Present the order and the rulings** to the user in prose, with the reasoning, and get confirmation. This is the last gate before the run goes autonomous.
5. **Create the ledger** (see below) and one todo per spec per phase.
6. **Run the project's collision gate** (e.g. `npm run collide`) if it has one.

## Step 3 — Isolate

Branch `<type>/<spec-slug>-<YYYYMMDD>`, worktree `.claude/worktrees/<spec-slug>-<YYYYMMDD>` — one pair per spec, named from that spec, never a combined slug and never a harness-generated random name.

**N = 1:** use `superpowers:using-git-worktrees`, then build inline.

**N ≥ 2:** the orchestrator creates every worktree itself, up front, and **stays on the main checkout** — it never enters a worktree, so it can always inspect all of them.

```bash
git worktree add -b <type>/<spec-slug>-<YYYYMMDD> \
  .claude/worktrees/<spec-slug>-<YYYYMMDD> origin/<default-branch>
```

For a **total** dependency, the base ref is the dependency's branch instead — and that worktree is created only after the dependency reports `PUSHED`. A **partial** dependency still branches from the default branch and starts immediately; it takes the dependency later, at its plan's merge point.

Then bootstrap each worktree the way the project requires (dependency install, and any per-checkout linking such as `npm run link:worktree` — a fresh worktree has none of the previous one's local state).

### Forks cannot enter their worktree — plan around it

`git worktree add` does **not** pin a child session's writes, and **`EnterWorktree` will not fix that for a fork.** Observed and reproduced by three independent forks: calling it with the correct absolute `path` is refused with

> *"the current working directory … is the repository root, not an isolated worktree — switching is only available to sessions whose working directory is inside a worktree of this repository."*

This is not a path-normalisation bug — `git worktree list --porcelain` reports the exact path and `pwd -P` inside it matches byte-for-byte. In this build `EnterWorktree` only switches *between* worktrees; **first entry from the launch directory is refused**, for the orchestrator and every fork alike, because both are launched at the repository root.

So isolation is a **discipline**, not a tool call, and the fork contract states it as a rule:

- every `Read`/`Write`/`Edit` takes an absolute path under the fork's worktree — never a relative one;
- every `Bash` call `cd`s into the worktree in the same command;
- `git -C <worktree-abs-path> branch --show-current` is checked before **every** commit and must print that fork's branch.

The repo's own branch gate (a pre-commit hook rejecting code commits on the default branch) is the **backstop**, not the primary guard. And the orchestrator, which stays on the main checkout, **watches `git status` there for stray writes** — a file it did not touch appearing dirty means a fork lost its discipline, and that is an escalation.

Do not spend a round-trip letting each fork rediscover this. Tell them at dispatch.

## Step 4 — Build

The plan is the unit of work. Whoever writes it — inline or in a fork — obeys this:

- Written with `superpowers:writing-plans`, saved to `docs/superpowers/plans/YYYY-MM-DD-<spec-slug>.md`. **Never** a repo-root `PLAN.md` — concurrent sessions collide there.
- **Migrations and deploys are explicit tasks in the plan**, each with its own verification: apply the migration and confirm it against the remote ledger; deploy through the project's wrapper and verify by re-downloading and grepping for the change. A version bump proves nothing. A shared module changing means every consumer redeploys.
- **Order them as late as the plan allows.** Git is disposable; the database is not. A branch can be abandoned after a failure — the migration it already applied cannot, and there is one shared database with no staging behind it. So a migration task sits after the code that depends on it is written and verified, never as an opening move, and a migration that would break the currently-deployed code if its branch never merges is a design the plan must avoid, not a risk it may take. Any migration applied on a branch that is later abandoned is reported to the user by name at Step 6 — production carries it whether or not the code ever ships.
- Hardened through the `codex-review` adversarial loop to `VERDICT: APPROVED` or `MAX_ROUNDS`.
  **The critical wiring:** codex-review works inside its own `$RUN_DIR/PLAN.md`. When the loop converges, the hardened plan **must be copied back over** `docs/superpowers/plans/<...>.md`, because implementation reads only that path. Verify the file's content actually changed before implementing.
- Implemented — **by whom, and how, depends on who owns the branch:**
  - **`N = 1`, this session builds:** run `superpowers:subagent-driven-development` to completion. The main session can spawn implementer subagents, so use them.
  - **`N ≥ 2`, a fork builds:** **implement inline — SDD is unavailable to a fork.** A fork's boilerplate carries `"Do NOT spawn subagents with the Agent tool"` as a hard, non-overridable rule, so SDD's fan-out mechanism cannot run there no matter what the directive says. The fork works the plan **directly, one task at a time, with verification per task and nothing marked done without reading real output** — SDD's discipline, minus its parallelism. Budget for it: this is the slowest part of an `N ≥ 2` run.
  **In both cases, override SDD's ending:** it finishes by calling `superpowers:finishing-a-development-branch`. Do **not** run it — it opens PRs and merges, which this skill forbids. Verification + push replaces it.
- Closed by the branch owner running the project's **full** lint, typecheck, build and test suite and reading the actual output — a subagent's report does not count — then `git push -u origin <branch>`. Never force-push. Red → fix, re-run; unfixable → escalate.

**N = 1:** run all of that inline, then go to Step 6.

**N ≥ 2:** the orchestrator forks itself once per spec — all forks dispatched **in a single message** so they start concurrently — using the contract in [dispatch-prompts.md](dispatch-prompts.md) § Fork implementer. Forks with an unmet **total** dependency are launched in `HOLD` state: they plan and codex-review, then stop and wait for a `GO`. Forks with a **partial** dependency are launched normally — their plan already orders the blocked tasks last.

**A fork is one-shot: it reports once and its turn ends.** Its boilerplate says so, and no directive overrides it. That is not a problem — it lines up with the phase structure — but it means the run is **two dispatches per fork, not one**:

1. The initial `Agent` call carries phases 1–3. The fork plans, runs codex-review, sends its `SURFACES` manifest, and its turn ends there. Which is exactly where the contract already told it to stop and wait for `GO`.
2. The orchestrator re-engages it with `SendMessage` for phases 4–5, once every manifest is in and its surfaces are ruled. That message *is* the `GO`, and it restates the locks.

Every later directive — `GO` on a lock, `MERGE`, `HOLD`, `REASSIGN` — is likewise a fresh `SendMessage` that revives the fork from its transcript with context intact. Plan the orchestration around message-driven revival, not around a fork that sits in a loop waiting.

**Name every fork after its spec — and record its `agentId`, because the name may not survive.** The `Agent` tool exposes exactly one naming lever, `description`. It *may* become the fork's name in `ListAgents`; **observed in practice, it did not** — three forks dispatched with distinct `description` values all listed as bare `agentId` handles with no name at all. So the `agentId` returned by the spawn call is the address that always works, and the ledger mapping `spec slug → agentId` is what keeps it unambiguous. Write it down at spawn; you cannot recover it from a listing that shows no names. Still pass the slug, both for the run's display and in case the build does name them:

```
description: "spec <spec-slug>"        # e.g. "spec inbound-close-time-clock"
subagent_type: "fork"                  # inherits this session's context; a model override is ignored
```

Never leave it generic ("implement the spec", "build feature") — an unnamed or vaguely-named session shows up as a random hex handle among dozens of peers, and you will not be able to tell your own forks apart.

At spawn, record in the ledger, per fork: **spec slug → name → `[ref]` → agentId**. Names are not unique on this machine — a listing can hold two identical ones — so the ledger mapping is what makes an address unambiguous. Send the bare name; append its ` [ref]` only when a listing or an error demands it.

## Step 5 — Orchestration loop (N ≥ 2 only)

The orchestrator writes no code, reviews no diffs line by line, and never implements a spec itself. Its whole job is traffic control.

**Channel.** Forks report to the orchestrator with `SendMessage to: "main"`. The orchestrator replies by name (from `ListAgents` or the spawn result), appending ` [ref]` only when a listing or an error demands it. Every fork also appends its checkpoints to its own ledger file — that file is the fallback channel if a message is ever lost, and the durable record after compaction.

**Fork → orchestrator checkpoints** (exact lines, one per event):

```
READY <slug>                                  # worktree entered, bootstrapped
PLAN <path> TASKS <n>                         # plan written
CODEX <APPROVED|REVISE> ROUNDS <n> COPIED_BACK <yes|no>
SURFACES <slug>                               # manifest, see below
TASK <phase> <i>/<n>                          # plan-phase boundaries only, never per task
LOCK <migration|deploy|file> <identifier>     # requesting the shared surface
APPLIED <migration files>                     # lock released
DEPLOYED <functions> VERIFIED <how>           # lock released
PUSHED <branch> <range>
BLOCKED <what, and what you tried>
WAITING <on what>
DONE <slug>
```

**The surface manifest** is sent right after codex-review, before any implementation, and lists what the *hardened plan* will actually touch — migrations, tables, edge functions, shared modules, source files. Step 2's pre-scan came from the specs; this comes from the plans, and it is the one that binds. The orchestrator intersects all manifests and re-rules any overlap Step 2 missed.

**Orchestrator → fork directives:**

```
GO                                  # dependency satisfied, or lock granted
HOLD <reason>                       # stop before the next phase, wait
COORDINATE WITH <fork name> ON <surface>   # talk to your peer directly, then report the agreement
MERGE <branch> BEFORE <action>      # take the peer's work first
REASSIGN <surface> TO <fork name>   # you no longer own this
```

**Serialization — the core duty.** One database and one deploy runtime are shared by every fork; worktrees isolate git, not those. So:

- **Only one fork applies migrations at a time.** A fork requests `LOCK migration <files>`, the orchestrator grants `GO` to exactly one, and waits for `APPLIED` before granting the next. Where two migrations touch the same table, the grant order is Step 2's ruling, not arrival order.
- **Only one fork deploys at a time**, same protocol, and a function owned by another fork is never deployed without that owner's `DONE` plus a `MERGE` directive.
- **A collision the orchestrator cannot resolve by ordering** — two forks that genuinely need to edit the same function body — is resolved by `COORDINATE WITH`: the two forks agree on one owner and one merge point, report the agreement, and the orchestrator records it in the ledger. If they cannot agree, escalate to the user.

**Liveness.** A fork that has sent nothing across a whole phase gets pinged. Two pings unanswered → read its ledger file and its worktree's `git log` directly, and escalate to the user with what you found. Silence is never treated as progress.

**Outstanding-lock sweep — do this every time you touch the ledger.** A fork waiting on a `GO` is silent *by design*, so the liveness rule above will never catch it. Read every `fork-<slug>.md` for a `LOCK` line with no matching grant, and grant or deny it. This is the one deadlock this design can produce on its own: the request arrives, your context compacts, the request is forgotten, and the fork waits forever while looking perfectly healthy. The ledger is the only record that survives — trust it over what you remember granting. Forks are instructed to re-send an ungranted `LOCK`; a re-send is a symptom that you dropped one, not noise.

**Releases.** When a fork reports `PUSHED`, immediately: create any worktree that was waiting to branch from it, send `GO` to every fork holding on it, and log the release.

**Escalations stop the whole run**, not just one fork: a task the fork could not resolve, a `REVISE` at MAX_ROUNDS, a red verification, an unapplied migration, an unresolvable collision. Report to the user with the fork, the finding, and the state of every other fork.

**How a stop actually stops.** Send `HOLD` to every fork, to take effect **at its next phase boundary** — never mid-phase. A fork currently holding a migration or deploy lock **finishes that operation and releases the lock first**: a half-applied migration or a half-deployed function set is worse than any delay the stop was trying to buy. A fork mid-implementation finishes its current plan phase, commits it, and holds. Then report the exact state of each fork: what it completed, what it holds, what it was about to do.

## Step 6 — Close-out report

Compose from the ledger — never from memory — and print inline, in the user's language:

- **Specs** — one line per spec: file path, and the one-sentence design it captured.
- **Branches** — one line per branch: name, commit range, what shipped, verification result.
- **Aplicado em produção** — migrations applied (with ledger confirmation) and functions deployed (with how each was verified), per branch.
- **Aplicado sem código** — any migration applied by a branch that was abandoned or left incomplete, named individually. The database kept it; git did not. This section being empty is a claim, so make it only after checking.
- **Ordem de merge** — the dependency order, explicitly, when one branch was based on another. Merging them out of order breaks the second.
- **Você precisa revisar** — what only a human can check: visual/UX, live e2e, external panel config, anything observable only in production.
- **Adiado / parked** — every deferred finding from every fork's ledger, with its ruling.
- **Não feito** — anything cut from a spec, and why.
- **Próximo passo** — the branches are pushed and verified, awaiting your review. Then `/session-end` per branch, in the merge order above, run in the fork that owns it. This skill does not open PRs and does not merge.

## Who the user talks to

State this explicitly in the close-out report — it is not obvious from the outside.

**During the run: the orchestrator, always.** It is the only session holding the whole picture, and the only one granting migration and deploy locks. A directive sent straight to a fork bypasses that: the orchestrator still believes the fork is holding, and may grant the lock to someone else — two concurrent `db push` against one database is exactly what the serialization exists to prevent. Want a detail from one fork? Ask the orchestrator; it asks and relays.

**After the run: `/session-end`, once per branch, in merge order — and it needs a session whose *working directory* is the worktree.** This is mechanical, not stylistic: `session-end` reads `git branch --show-current` at its Step 0 and must leave the worktree to remove it at Step 9, so it assumes cwd, not `-C` flags.

That is a real constraint here, because of the `EnterWorktree` refusal in Step 3: **no session in this run is inside its worktree** — not the orchestrator, which stands on the main checkout, and not the forks, which are launched at the repository root and were refused entry. So neither can simply run `/session-end` and have it work on the right branch.

Tell the user plainly, in the close-out report: **start a session with the worktree as its working directory** (`cd .claude/worktrees/<slug>-<date>` and launch there) and run `/session-end` in it, once per branch, in the printed merge order. Everything that step needs from the run is in the ledger — each fork's final `PARKED` and `CUT` lines are there precisely so a fresh session can write honest pendings without having built the branch itself.

If the user would rather keep talking to one session, the orchestrator can relay: it holds the whole picture and every fork's close-out. What it cannot do is be inside N worktrees. Offer the relay; never claim it can run `/session-end` for them from the main checkout.

**Merge order binds either way.** A branch created from another's head merges second. Print the order, and say why.

## Ledger

`.superpowers/session-build/<RUN_ID>/`, where `<RUN_ID>` is `<YYYYMMDD-HHMM>` at Step 2. Pass it verbatim to every fork — they write into the same directory:

- `ledger.md` — first line `# session-build — specs: <list>`. Orchestrator-owned: spec list, dependency graph, collision rulings, fork names, every lock grant and release, every escalation.
- `fork-<spec-slug>.md` — one per fork, fork-owned: every checkpoint it sent, plus plan path, codex verdict, commit range, deploy state, parked findings.

Context does not survive compaction; the ledger does. On resume, trust the ledger, `git log` and `git worktree list` over recollection, and restart at the first phase with no completion line.

## Common mistakes

| Mistake | Reality |
|---|---|
| "One branch for all the specs" | Parallel forks on one branch destroy each other. One spec, one branch, one worktree. |
| "Co-dependent forks may as well share a worktree" | The dependency is temporal — the waiting fork could not build there anyway. Sharing only adds `index.lock` contention, builds that read a neighbour's half-written files, and gates failing on someone else's breakage. Partial dependency → order the plan. Total → branch from the dependency. Entangled → it was one spec. |
| "The orchestrator can implement the small one itself" | Then it stops answering forks and locks go ungranted. It orchestrates or it builds — never both. |
| "Worktrees isolate everything" | They isolate git. The database and the deploy runtime stay shared. That is what the locks are for. |
| "`git worktree add` puts the fork in the worktree" | It does not pin the child session's writes. |
| "Then the fork calls `EnterWorktree` and it is pinned" | It is refused — first entry from the launch directory does not work in this build, for forks or the orchestrator. Isolation is absolute-path discipline plus a `git -C … branch --show-current` check before every commit. |
| "A fork sits and waits for my `GO`" | It is one-shot; its turn already ended at the manifest. Every directive is a fresh `SendMessage` that revives it. |
| "Forks run SDD like I would" | They cannot spawn subagents — hard rule, not overridable. A fork implements inline, one task at a time. Only an `N = 1` inline build uses SDD. |
| "Forks inherit context, so they know the rulings" | They inherit the conversation, not decisions you make after forking. Directives go over the wire. |
| "The plan is in the codex run dir, close enough" | Implementation reads `docs/superpowers/plans/`. Copy the converged plan back or you ship the un-hardened one. |
| "SDD said to finish the branch" | `finishing-a-development-branch` opens PRs and merges. Forbidden here. Verify and push instead. |
| "The user can run `/session-end` in the orchestrator" | It assumes the worktree is the cwd, and no session in the run is inside one. The user launches a session **from** the worktree directory. |
| "Migrations and deploys come after implementation" | They are tasks *in* the plan, with their own verification, executed under an orchestrator lock. |
| "Push triggers the deploy" | Verify by re-downloading the deployed function. Bulk redeploys silently fail. |
| "The fork's report says tests passed" | The branch owner runs the full suite itself before pushing. Nothing else counts. |
| "A quiet fork is a working fork" | Ping it, read its ledger and its git log, escalate. Silence is not progress. |
| "A fork waiting on a lock is fine, it will speak up" | It is silent *because* it is blocked, and the liveness rule keys on silence. Sweep the ledgers for ungranted `LOCK` lines every time you touch them. |
| "The branch failed, so nothing shipped" | Its migration already landed in the one shared database. Git rolls back; production does not. Name it in the report. |
| "The work is done, I'll open the PR" | This skill never opens a PR and never merges. `/session-end` does, when the user runs it. |

## Red flags — stop

- About to run `gh pr create`, any merge, or `finishing-a-development-branch`.
- About to start implementation with two forks on the same branch, or with the orchestrator writing code.
- About to grant two migration or deploy locks at once.
- About to let a fork deploy an edge function another fork owns.
- About to create a total-dependency branch before its dependency reported `PUSHED`.
- About to put two sessions in one worktree, for any reason.
- About to grant a `GO` without sweeping the ledgers for an older ungranted `LOCK`.
- About to wait on a fork that stopped at its `SURFACES` manifest. It is finished, not working — re-engage it or it never moves.
- About to tell a fork to run `subagent-driven-development`, or to treat `EnterWorktree` as its isolation.
- About to confirm a dependency graph without having checked it for a cycle.
- About to abandon or park a branch whose migration already landed, without naming that migration to the user.
- About to halt a fork mid-migration or mid-deploy to enforce a stop.
- A plan file unchanged after its codex-review returned APPROVED.
- About to `git commit` on `main`/`master` (code), or to slip `--no-verify`/`--force` past a gate.
- About to report a branch as done without having read the verification output yourself.
- A spec in the confirmed scope with no branch, or a branch with no pushed commits.
