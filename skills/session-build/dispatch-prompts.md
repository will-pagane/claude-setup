# Dispatch prompts — session-build

Used only when `N ≥ 2` specs. Dispatch every fork **in a single message** so they start concurrently.

A fork inherits the orchestrator's **full conversation context** — the brainstorm, every spec, every ruling made before the fork existed. So the prompt below is a list of **directives and boundaries**, not a context dump. What it must still state explicitly is everything decided *after* the fork could have inherited it: its own slug, its own worktree, its dependencies, and its surface rulings.

Anything decided *after* dispatch travels over `SendMessage`, never by assumption.

---

## § Naming

`description` is the only naming lever the `Agent` tool exposes. It *may* become the fork's name in `ListAgents` — but **do not count on it**: observed in a live run, three forks dispatched with distinct `description` values all listed as bare `agentId` handles, nameless. Always:

```
subagent_type: "fork"                  # inherits context; a model override is ignored
description:   "spec <spec-slug>"      # e.g. "spec inbound-close-time-clock"
```

**Record `spec slug → agentId` in the ledger at spawn, from the spawn call's own result.** The `agentId` is the address that always resolves, and if the listing shows no names it is the *only* one you can recover. Add `name → [ref]` too when the build does provide them — peer names on one machine are not unique, so the ledger mapping is what keeps an address unambiguous either way.

---

## § Fork implementer

One per spec. Fill every `<...>` before sending.

**Two dispatches per fork, not one.** A fork is one-shot — it reports once and its turn ends — and it cannot spawn subagents. So the prompt below carries **phases 1–3** and the fork stops at its `SURFACES` manifest, which is where the contract wanted it to stop anyway. The orchestrator then re-engages it with `SendMessage` for **phases 4–5** (§ Fork re-engagement), and every later directive is likewise a fresh message that revives it from its transcript with context intact.

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
  <ABS_MAIN_CHECKOUT>/.superpowers/session-build/<RUN_ID>/fork-<spec-slug>.md — ABSOLUTE, and in
  the MAIN checkout, not your worktree. The orchestrator sweeps that directory for ungranted
  LOCK lines; a file written inside your worktree is invisible to it and the sweep then reports
  "no pending locks" while yours sits there.
  You will NOT be able to commit that file — it is on the default branch, which is closed to you.
  That is expected: the orchestrator commits it. Write it, never try to commit it.

YOUR PEERS — you can address them directly
  <spec-slug> → <agentId>            (one line per peer fork in this run)
  Forks list as bare handles, not names, so without this map a COORDINATE WITH directive is
  unreachable and you would have to relay everything through main. Use these ids with SendMessage
  when told to coordinate. Never guess a handle you were not given.
  WRITE it on every checkpoint; do NOT commit it on every checkpoint. The file on disk is what
  survives compaction — a commit adds no durability and buys no sharing, since no peer reads your
  ledger through git. Commit it at most twice: once when your surfaces are settled, once at
  PUSHED. A commit per checkpoint runs the repo's hooks over and over on a machine already
  saturated by your peers, and buries your real commits.

FREEZE — if you are ever told a peer has merged your branch, or to hold for a peer's push
  Then you make NO COMMITS until released. Not "no code commits" — none at all: docs, ledger,
  .gitignore, a typo fix. The gate your peer depends on compares HEADs, so the CONTENT of your
  commit is irrelevant and the most harmless one is exactly as fatal as the riskiest. Do not
  invent an exception; the exception everyone invents is "surely recording this in the ledger is
  fine", and that is the commit that has already broken a real run.
  You MAY still churn the working tree freely — restoring a peer's files to unblock your own
  migration, then deleting them. That does not move HEAD and is not a freeze violation. Note it
  in your ledger file (which you are writing, not committing) so it does not look like one.

FIRST ACTION — AND THE RULE THAT REPLACES IT
  Do NOT call EnterWorktree. It will refuse you: your working directory is the repository root,
  and this build only switches BETWEEN worktrees, never into the first one from the launch
  directory. Three forks reproduced this; it is not a path problem and not worth a round-trip.
  Your writes are therefore NOT pinned by anything. Isolation is your discipline:
    - every Read/Write/Edit takes an absolute path under <ABS_WORKTREE_PATH> — never a relative one;
    - every Bash call cd's into <ABS_WORKTREE_PATH> in the same command;
    - before EVERY commit, `git -C <ABS_WORKTREE_PATH> branch --show-current` must print <branch>.
  The launch directory is checked out on the default branch, so a stray bare git command commits
  there. The repo's branch gate is the backstop, not your guard — and the orchestrator is watching
  the main checkout's `git status` for files you dirtied by accident.
  Verify the worktree by hand instead (`git -C <ABS_WORKTREE_PATH> branch --show-current`, tree
  clean, deps installed, any per-checkout linking working), bootstrap only what is missing
  (<PROJECT_BOOTSTRAP_COMMANDS>), and send:
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
  do not re-plan from scratch. Pass rounds=until-approved: the loop is UNCAPPED and runs until
  VERDICT: APPROVED, revising between rounds and resuming the same Codex thread every round.
  Never stop to ask whether to keep going — that is exactly what this mode exists to prevent.
  If codex-review's stall guard fires (3 consecutive rounds, same blocking objection, plan
  unchanged), send CODEX STALL ROUND <n> <objection> as INFORMATION and KEEP GOING: write your
  rebuttal into the plan text itself rather than repeating it in chat, and loop again.
  MANDATORY LAST STEP: copy the converged $PLAN_FILE back over
  docs/superpowers/plans/<YYYY-MM-DD>-<spec-slug>.md. Implementation reads only that path; a
  hardened plan left in the run dir is worthless. Then send:
    CODEX APPROVED ROUNDS <n> COPIED_BACK <yes|no>
  APPROVED is the only verdict that ends this phase. There is no cap to hit and nothing to
  escalate here — you do not proceed to Phase 3 on anything else.

PHASE 3 — SURFACE MANIFEST, THEN WAIT
  From the HARDENED plan (not the spec), list everything it will touch, and send:
    SURFACES <spec-slug>
      migrations: <files, and the tables each touches>
      functions:  <edge/serverless functions>
      shared:     <shared modules>
      files:      <source files outside the above>
  Then STOP — this is where your turn ends, and that is correct, not a failure. The orchestrator
  is intersecting your manifest with the other forks' and may reassign a surface or order you
  behind a peer. It re-engages you by message for phases 4-5; you resume with full context.

PHASE 4 — IMPLEMENT (arrives as a message; do not start it in this turn)
  Work the plan INLINE, task by task. Do NOT invoke `superpowers:subagent-driven-development`
  and do NOT spawn implementer subagents — your hard rules forbid the Agent tool, so SDD's
  mechanism cannot run in you. Keep its discipline instead: one task at a time, verification
  belonging to that task run before it is marked done, and nothing claimed done without reading
  real output. Never a subagent's word, never "should work now".
  You may NOT fork another session.
  OVERRIDE THE SDD ENDING you would otherwise reach for: `finishing-a-development-branch` opens
  pull requests and merges, forbidden in this whole run. Phase 5 replaces it.
  Send TASK progress only at plan-phase boundaries, not per task. Send BLOCKED <what, and what
  you tried> the moment you cannot resolve something, and WAIT.

  SHARED-SURFACE LOCKS — one database and one deploy runtime are shared by every fork.
  Your worktree isolates git and nothing else. So before the plan's migration or deploy tasks:
    send  LOCK migration <files>      → wait for GO → apply → send APPLIED <files>
    send  LOCK deploy <functions>     → wait for GO → deploy + verify → send DEPLOYED <functions> VERIFIED <how>
  BLOCKED MEANS END YOUR TURN, not wait inside it. When you are holding for a GO, a merge point
  or a peer, write the state to your ledger file, send WAITING <on what>, and STOP. Do not spin
  on tool calls to pass the time — it burns calls and leaves the reason for the wait only in your
  head. Ending the turn puts it in the ledger, and the orchestrator's directive revives you with
  full context. Two forks did this in a live run and it cost nothing.
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
  CODEX: APPROVED / <rounds> <"(N stalls)" if the stall guard fired>
  MIGRATIONS: <applied files, or "none">
  DEPLOYS: <functions + verification method, or "none">
  VERIFY: <lint/build/test result you read yourself>
  PARKED: <one entry per deferred finding, or "none">
    Write each as a DRAFT PENDINGS ENTRY, not a note to yourself. It is the only thing that
    survives from you to whoever closes the branch, and they cannot re-open your investigation.
    Each entry carries: file and line · the number you measured AND how you measured it · the
    shape of the fix · the exposure left open meanwhile. "Found X, deferred" is worthless; an
    entry someone can paste into the pendings file without re-deriving anything is the bar.
    MARK ANY PROOF THAT CANNOT BE REPRODUCED. If you established something in a window that has
    since closed — an equivalence checked before a migration that now makes the old path raise —
    say so in the entry. Otherwise the next session re-runs it, gets a failure, and concludes
    something broke.
  CUT: <one line per spec requirement not implemented, or "none">
```

---

## § Fork re-engagement

Sent by `SendMessage` once every manifest is in and the fork's surfaces are ruled. This message **is** the `GO` for phases 4–5.

```
main → <spec-slug>

GO for PHASES 4-5.

SURFACE RULINGS that apply to you (from intersecting all <N> manifests):
  <one line each: owned / reassigned / ordered behind a peer / merge point>

IMPLEMENT INLINE. No subagent-driven-development, no Agent spawns — your hard rules forbid them,
and the plan is already codex-hardened. One task at a time, its verification run before it is
marked done, nothing claimed done without reading real output.

LOCKS STILL BIND inside this turn. Before the plan's migration or deploy tasks:
  send LOCK migration <files>   → WAIT for my GO → apply → send APPLIED <files>
  send LOCK deploy <functions>  → WAIT for my GO → deploy + verify → send DEPLOYED <...> VERIFIED <how>
<state the ordering: who applies before whom, and what you are held behind>

ISOLATION: absolute paths under <ABS_WORKTREE_PATH>, cd-first in every Bash call, and
`git -C <ABS_WORKTREE_PATH> branch --show-current` checked before every commit.

Then PHASE 5: run the full suite yourself, read the output, push, and send PUSHED + DONE.
```

Keep it short. The fork revives with its whole transcript — restate only what changed since it stopped.

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
- **Between 3 and 4:** every fork re-engaged by `SendMessage` (§ Fork re-engagement). A fork that stopped at its manifest is *finished*, not waiting — nobody revives it but you, and a fork you forgot to re-engage looks exactly like a fork that is quietly working.
- **Phase 4:** exactly one migration lock and one deploy lock outstanding at any moment.
- **Phase 5:** every branch pushed, every `PARKED` and `CUT` line collected into the ledger — they are the close-out report, and they are invisible to a compacted context.
