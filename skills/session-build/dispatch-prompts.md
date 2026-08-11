# Dispatch prompts — session-build

Used only when `N ≥ 2` specs. Dispatch every fork **in a single message** so they start concurrently.

A fork inherits the orchestrator's **full conversation context** — the brainstorm, every spec, every ruling made before the fork existed. So the prompt below is a list of **directives and boundaries**, not a context dump. What it must still state explicitly is everything decided *after* the fork could have inherited it: its own slug, its own worktree, its dependencies, and its surface rulings.

Anything decided *after* dispatch travels over `SendMessage`, never by assumption.

---

## § Naming

`description` is the only naming lever the `Agent` tool exposes, and its value becomes the fork's name in `ListAgents` — which is its address. Always:

```
subagent_type: "fork"                  # inherits context; a model override is ignored
description:   "spec <spec-slug>"      # e.g. "spec inbound-close-time-clock"
```

Record `spec slug → name → [ref] → agentId` in the ledger at spawn. Peer names on one machine are not unique; the ledger mapping is what keeps an address unambiguous.

---

## § Fork implementer

One per spec. Fill every `<...>` before sending.

```
You are the child session that owns exactly one spec, start to finish. You inherited this
session's context — the brainstorm and all the specs are already known to you. What follows is
binding, and overrides anything you would otherwise infer.

IDENTITY
  Spec slug:  <spec-slug>
  Spec file:  <ABS_SPEC_PATH>
  Branch:     <type>/<spec-slug>-<YYYYMMDD>
  Worktree:   <ABS_WORKTREE_PATH>
  Dependency: <none | soft on <slug> | partial on <slug> (<branch>) | total on <slug>>
  This worktree is yours alone. No other session writes in it, and you write in no other.
  You are ONE of <N> forks running right now. You own your spec and nothing else.
  Sign every message you send with your slug. The orchestrator tracks you by it.

CHANNEL
  Report to the orchestrator with SendMessage to: "main". Its directives arrive as
  <cross-session-message>. Also append every checkpoint to
  .superpowers/session-build/<RUN_ID>/fork-<spec-slug>.md — that file is the durable record and
  the fallback channel if a message is ever lost.

FIRST ACTION
  Call EnterWorktree with path: <ABS_WORKTREE_PATH>. Do this before reading or writing anything.
  A worktree that exists on disk does not pin your writes until you enter it.
  Then bootstrap it as the project requires (<PROJECT_BOOTSTRAP_COMMANDS>), and send:
    READY <spec-slug>

PHASE 1 — PLAN
  Invoke `superpowers:writing-plans` and follow it exactly.
  Write to: docs/superpowers/plans/<YYYY-MM-DD>-<spec-slug>.md — never a repo-root PLAN.md.
  The plan MUST carry, as explicit tasks with their own verification:
    - every migration, applied file-first via the migration CLI and confirmed against the
      remote ledger;
    - every edge/serverless function deploy, through the project's wrapper, verified by
      re-downloading and grepping for the change (a version bump proves nothing), plus every
      consumer redeployed when a shared module changes.
  ON A PARTIAL DEPENDENCY: order the plan so every task that does NOT need the dependency's code
  comes first, and put the dependent tasks after a single merge point, marked in the plan. You
  will receive `MERGE <branch> BEFORE <task>` when that dependency lands — you build until then
  instead of idling. Never wait on a dependency you do not actually need yet.
  Do NOT run the skill's "Execution Handoff" section and do NOT ask the user anything — the
  orchestrator owns execution. Run its Self-Review, fix what it surfaces, then send:
    PLAN <path> TASKS <n>

PHASE 2 — CODEX REVIEW
  Invoke `codex-review` with slug=<spec-slug>. The unique slug keeps your run dir from colliding
  with the reviews running in parallel right now. Seed the loop with the plan you just wrote —
  do not re-plan from scratch. Run to VERDICT: APPROVED or MAX_ROUNDS, revising between rounds.
  MANDATORY LAST STEP: copy the converged $PLAN_FILE back over
  docs/superpowers/plans/<YYYY-MM-DD>-<spec-slug>.md. Implementation reads only that path; a
  hardened plan left in the run dir is worthless. Then send:
    CODEX <APPROVED|REVISE> ROUNDS <n> COPIED_BACK <yes|no>
  A REVISE at the cap is an escalation — send it and WAIT.

PHASE 3 — SURFACE MANIFEST, THEN WAIT
  From the HARDENED plan (not the spec), list everything it will touch, and send:
    SURFACES <spec-slug>
      migrations: <files, and the tables each touches>
      functions:  <edge/serverless functions>
      shared:     <shared modules>
      files:      <source files outside the above>
  Then STOP. Do not implement until the orchestrator replies GO. It is intersecting your
  manifest with the other forks' and may reassign a surface or order you behind a peer.

PHASE 4 — IMPLEMENT
  Run `superpowers:subagent-driven-development` to completion on your plan.
  OVERRIDE ITS ENDING: SDD finishes by calling `superpowers:finishing-a-development-branch`.
  Do NOT run it. It opens pull requests and merges, which are forbidden in this whole run.
  Phase 5 replaces it.
  You may spawn implementer subagents — that is SDD's mechanism. You may NOT fork another
  session.
  Send TASK progress only at plan-phase boundaries, not per task. Send BLOCKED <what, and what
  you tried> the moment SDD cannot resolve something, and WAIT.

  SHARED-SURFACE LOCKS — one database and one deploy runtime are shared by every fork.
  Your worktree isolates git and nothing else. So before the plan's migration or deploy tasks:
    send  LOCK migration <files>      → wait for GO → apply → send APPLIED <files>
    send  LOCK deploy <functions>     → wait for GO → deploy + verify → send DEPLOYED <functions> VERIFIED <how>
  Write every LOCK to your ledger file as you send it, and strike it when the GO arrives. If no
  GO has arrived after roughly ten of your own tool calls, RE-SEND the same LOCK line. Waiting on
  a lock makes you look idle rather than blocked, so a dropped request is invisible from the
  outside — the re-send is how it surfaces. Never proceed unlocked because the wait got long.
  Never apply a migration or deploy a function without a GO in hand. Never touch a function
  another fork owns unless you received an explicit MERGE or REASSIGN directive.

PHASE 5 — VERIFY AND PUSH
  Run the project's FULL lint, typecheck, build and test suite yourself and read the actual
  output. A subagent's report does not count. Red → fix and re-run; unfixable → BLOCKED.
  Then `git push -u origin <branch>`. Never force-push, never --no-verify. Send:
    PUSHED <branch> <first7>..<last7>
    DONE <spec-slug>
  Then STOP and stay available. Leave the worktree and the branch exactly as they are — the user
  reviews your branch and runs `/session-end` in YOU, because you are the session standing in its
  worktree and holding what its pendings step needs. Do not clean up, do not merge, do not
  open a pull request.

FORBIDDEN, ABSOLUTELY
  gh pr create · any merge · finishing-a-development-branch · force-push · --no-verify ·
  --squash · committing on the default branch · deleting any branch or worktree · working
  outside your worktree · editing another fork's spec, plan or surfaces · asking the user
  anything (route it through the orchestrator).

DIRECTIVES YOU MAY RECEIVE
  GO                                   proceed with the phase or lock you requested
  HOLD <reason>                        stop before the next phase and wait
  COORDINATE WITH <name> ON <surface>  message that peer directly, agree on one owner and one
                                       merge point, then report the agreement to main
  MERGE <branch> BEFORE <action>       take the peer's branch into yours first
  REASSIGN <surface> TO <name>         drop that surface from your plan; it is no longer yours

FINAL REPLY — exactly these lines, nothing else:
  SPEC: <spec-slug>
  BRANCH: <branch>
  RANGE: <first7>..<last7>
  PLAN: <path>
  CODEX: <APPROVED|REVISE> / <rounds>
  MIGRATIONS: <applied files, or "none">
  DEPLOYS: <functions + verification method, or "none">
  VERIFY: <lint/build/test result you read yourself>
  PARKED: <one line per deferred finding, or "none">
  CUT: <one line per spec requirement not implemented, or "none">
```

---

## § Peer coordination

When the orchestrator sends `COORDINATE WITH <name> ON <surface>`:

1. Try `ListAgents` and `SendMessage` to that name directly (append its ` [ref]` only if the listing shows a duplicate).
2. If the peer is not addressable from your session, **relay through `main`** — send the orchestrator what you want the peer to know and let it forward. Never assume the peer heard you.
3. Agree on exactly two things: **who owns the surface**, and **what the merge point is** (which branch takes the other's work, and when).
4. Report the agreement to `main` in one line: `AGREED <surface> OWNER <slug> MERGE <branch> AFTER <event>`. An agreement the orchestrator did not record does not exist.

---

## § Orchestrator check-ins

Short, addressed by name, one purpose each:

```
status <spec-slug>?                          # a fork silent across a whole phase
GO                                           # lock granted / dependency released
HOLD <reason>                                # a collision ruling landed
COORDINATE WITH <name> ON <surface>
MERGE <branch> BEFORE <action>
REASSIGN <surface> TO <name>
```

Two unanswered pings → stop pinging. Read `fork-<slug>.md` and that worktree's `git log` directly, then escalate to the user with what you found. Silence is never progress.

---

## § What the orchestrator owes after the fan-out

- **Phase 1:** every promised plan file exists and is non-trivial.
- **Phase 2:** every plan file's content actually changed after APPROVED (or the reviewer approved round 0 with no revisions — confirm, don't assume). `COPIED_BACK: no` → do the copy yourself before granting GO, or that fork implements the un-hardened plan.
- **Phase 3:** all `N` manifests intersected before the first GO. A GO granted before the last manifest arrived is a collision you chose not to see.
- **Phase 4:** exactly one migration lock and one deploy lock outstanding at any moment.
- **Phase 5:** every branch pushed, every `PARKED` and `CUT` line collected into the ledger — they are the close-out report, and they are invisible to a compacted context.
