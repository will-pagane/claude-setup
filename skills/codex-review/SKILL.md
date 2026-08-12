---
name: codex-review
description: A standalone adversarial PLAN-review loop where Claude Code (builder) and OpenAI Codex (read-only critic) tag-team an implementation plan before any code is written. Use this when you ALREADY have a plan or a clear idea and just want the cross-model stress-test — no requirements interview first. Claude drafts/loads the plan into PLAN.md, Codex reviews it in a read-only sandbox and returns VERDICT:APPROVED or VERDICT:REVISE, Claude revises and re-submits to the SAME Codex session (context preserved) until APPROVED or a configurable MAX_ROUNDS cap is hit. Human approves the converged plan before code. Use when the user says "/codex-review", "codex review my plan", "have Codex review my plan", "argue this plan with Codex", "adversarial plan review", "make Claude and Codex argue/fight over the plan", or is about to build something high-stakes (auth, schema, concurrency, migrations, payments) and wants a second-model sanity check on the PLAN before implementation. For a guided requirements interview BEFORE the review, use /grill-me-codex instead. NOT for reviewing already-written CODE (that is the Codex plugin's /codex:review) and NOT for trivial changes.
---

# Codex-Review — Adversarial Plan-Review Loop

Two models, one plan, a bounded argument. **Claude is the builder and orchestrator. Codex is a read-only critic** that can read the repo and the plan but cannot touch a single file. They communicate strictly through this run's plan file (`$PLAN_FILE`, under a timestamped `$RUN_DIR`) + a Codex session that persists across rounds. The human enters at exactly two points: kickoff and final sign-off.

This is a **deliberate, high-stakes tool** — reach for it on auth, data models, concurrency, migrations, payments, anything expensive to get wrong. Skip it for obvious/cheap work.

## Prerequisites (verify once, fast)

- Codex CLI installed and recent: `codex --version` (need ≥ 0.130; the default `gpt-5.5` model errors on older CLIs).
- Codex authenticated: a prior `codex login` (ChatGPT account is fine). If a run returns an auth/model error, surface it to the user — do not silently retry.
- Do NOT pin `-m` unless the user asks. The user's `~/.codex/config.toml` default model is used. Pinning `gpt-5.x-codex` variants fails on ChatGPT-account auth.
- **Sandbox flag differs between the two commands.** `codex exec` accepts `-s read-only`. `codex exec resume` does NOT — it rejects `-s` ("unexpected argument"). On resume you MUST force read-only via `-c sandbox_mode="read-only"`, because `config.toml` may default `sandbox_mode` to `danger-full-access` (+ `approval_policy="never"`) — which would let Codex WRITE files mid-loop. This is the single most important safety detail in this skill: verified end-to-end on 2026-06-04.

## Tunable variables (read from skill args, else default)

| Var | Default | Meaning |
|-----|---------|---------|
| `MAX_ROUNDS` | `5` | Cap on review rounds. The loop terminates here **unless** `rounds=until-approved`. |
| `SLUG` | derived from the task (2–5 kebab-case words) | Names the run. Keep it descriptive, e.g. `wave5-cleanup`, `anon-rpc-hardening`. |
| `STAMP` | `$(date +%Y%m%d-%H%M)` | Run timestamp. Makes the run dir unique so parallel sessions never collide. |
| `RUN_DIR` | `docs/codex-review/<SLUG>-<STAMP>/` | **Per-run, session-owned folder.** All of this run's artifacts live here — nothing at repo root. Mirrors how `docs/superpowers/` scopes its artifacts. Created at kickoff. |
| `PLAN_FILE` | `$RUN_DIR/PLAN.md` | Where the evolving plan lives (inside the run dir, never repo root). |
| `LOG_FILE` | `$RUN_DIR/PLAN-REVIEW-LOG.md` | Append-only transcript of the argument (every round's critique + what changed). The artifact. |
| `VERDICT_FILE` | `$RUN_DIR/codex-verdict.txt` | Codex's last-message capture. **Per-run, NOT `/tmp`** — a shared `/tmp/codex-verdict.txt` clobbers across concurrent runs. |

If the user invoked the skill with an argument like `rounds=3`, use that for `MAX_ROUNDS`. You may also pass `slug=<...>` to override the derived slug. Echo the resolved values (including the full `RUN_DIR`) back before starting.

### `rounds=until-approved` — no cap, no human tie-break

Pass `rounds=until-approved` and the loop **keeps going until `VERDICT: APPROVED`**. It never breaks to the deadlock hand-off, and it never stops to ask permission to continue. Use it when the caller is an autonomous run that must not pause — `session-build`'s forks pass it by default, because a run that parks on a tie-break at round 5 has stalled the whole fan-out waiting for a human who may be asleep.

Every round still resumes the **same** Codex thread (`codex exec resume "$THREAD_ID"`), so the critic keeps full context however long the argument runs — this is a longer argument, not a series of fresh ones.

**The stall guard, which does not stop the loop.** Unbounded means a genuinely irreconcilable disagreement could spin forever, so track it rather than ignore it. When **3 consecutive rounds** produce a `REVISE` whose blocking objections are substantively the same as the previous round's *and* `PLAN_FILE` did not change, the argument has stalled — Codex is repeating itself and Claude is holding. Then, **without pausing**:

1. Log `### STALL DETECTED — round <n>` in `LOG_FILE` with the repeating objection.
2. **Change tactic rather than repeat yours.** Either concede the point and write it into the plan, or restate your counter-position in the plan text itself (as an explicit "considered and rejected because …" note) so Codex is reviewing a plan that answers it instead of a plan that ignores it. A repeated objection usually means the rebuttal lived in the chat and never reached the document.

**Do not wait for a stall to apply this — it is the standing rule.** Every rebuttal belongs in the plan the reviewer re-reads, from round 1. Codex re-reads the document, not the conversation, so an argument made only in the prompt is invisible to the next round by construction. Two forks in an independent run reported, without prompting and without knowing of each other, that writing rebuttals into the document was the single thing that stopped an objection from returning the following round. The stall guard exists for the rounds where this was forgotten.
3. Keep going.

If a caller is orchestrating (a `session-build` fork), report the stall over its channel as information — never as a request for permission.

**Observed across two independent runs, for whoever wonders whether past round 5 is just noise.** Eight plans, zero stalls. Run A: approvals at rounds 5, 9 and 10, with rounds 6–9 of one producing 8 new findings and rounds 6–10 of another producing 18. Run B, a different project: approvals at 3, 3, 3, 6 and 7 — **the default cap of 5 would have forced a human tie-break on two of the five, and those two found that run's most serious defects.**

Two things follow, and the second matters more than the first. The tail is not the loop spinning; it is the review still working. And **plans that need few rounds still finish in few rounds** — three of eight approved at round 3 — so removing the cap costs nothing on the easy ones and buys the hard ones exactly where the value was concentrated.

### The re-copy trap — the most common cause of a stall

**Revise the artifact Codex re-reads. Never regenerate it from a source that lacks your rebuttals.**

`$RUN_DIR/PLAN.md` is what Codex re-reads each round, so it is what must accumulate the argument. A caller that keeps a canonical plan elsewhere — `session-build`'s forks keep theirs under `docs/superpowers/plans/` — is tempted to re-copy that file into `PLAN.md` at the top of every round. That copy **destroys everything written into `PLAN.md` since the last one**, and the first casualty is the "considered and rejected because …" section, which is precisely the part meant to answer Codex.

The failure is invisible from the inside: Claude answers the objection every round, Codex never sees the answer because it re-reads a document the copy just reverted, and the same objection returns forever. Confirmed from inside a live run — it was the direct cause of a plan that bounced from round 3 to round 6.

Copy the plan in **once**, at kickoff. After that, revise `PLAN.md` in place and copy it back out at the end. If a caller genuinely must re-copy each round, its rebuttal section has to live in the **canonical** file so the copy carries it in rather than wiping it.

### A correction looks like verification

**This loop's most dangerous blind spot, and it survives any number of rounds.** The pattern is not "people assert things without checking". It is that **correcting is the operation that most feels like it dispenses with checking**, because it already feels like diligence. A correction arrives dressed as the careful move, so nobody asks it for evidence.

Observed, three times in one run, always the same shape — a confident claim, repeated downstream, never once checked against the thing it describes:

- A spec asserted a column was nullable. The plan repeated it. The migration encoded `= NULL`. **Five adversarial rounds went straight over it**, because both models were reading the same spec rather than the catalogue. The database caught it, with a `NOT NULL` violation, in production.
- A fork reported that the CLI does not download shared modules; the orchestrator relayed and amplified it; a second fork found the project's own docs contradicting it and prepared a correction to the docs. **Nobody had run the download.** The CLI does download them.
- And the case that closes the argument: **the claim being corrected was the true one.** Applying that correction would have deleted a working warning and installed a hazard in its place — the rule it was about to remove existed *because* the bundle carries those modules.

So:

1. **A finding that asserts a fact about the system — a column's nullability, an API contract, a tool's behaviour — is applied only after reading it from the source**, not from the document that cites it. This binds the reviewer's finding and the builder's rebuttal equally. Two models reading the same spec is not two witnesses; it is one witness quoted twice.
2. **Plan review does not substitute for reading the catalogue — or for compiling the code.** This loop's strength is internal coherence and consequence — whether the plan contradicts itself, whether step 4 breaks step 2. It is **structurally blind** to *"the world is not like that"*, because it only ever sees the document. Migrations are where that blindness executes, so any plan step encoding a fact about existing schema gets that fact read from the live system before it ships. The same limit applies downstream of the plan: in one run a defect survived **five rounds here plus 1459 passing tests and a clean bundler build**, and was caught only by a typecheck that ran nowhere until the first push. No number of rounds substitutes for a check that can actually go red on the thing being claimed.
3. **When correcting a written claim, test the OLD version, not the new one.** Cheap, decisive, and precisely the step that the feeling of fixing skips. If the old claim survives the test, the correction was the error.
4. **Hold a replacement to the bar you set for what it replaces.** When a rebuttal defeats a proposal and offers a different mechanism in the same breath, the new mechanism arrives carrying the credibility of the argument that killed the old one — and gets waved through at the exact moment scepticism is cheapest, since no code exists yet. Observed: a reviewer demanded a caller survey before accepting a change, got one, was rightly persuaded, and then accepted the substitute **without asking for the same survey**. The substitute was wrong in the same way and only a later round caught it. Whatever evidence you required in order to reject, require again in order to endorse.
5. **"I ran it" is not the end of the question — ask whether the run reached.** A check can execute, exit clean and print something plausible while stopping before the thing it was meant to prove: calling a gated function as a service role returns at the authorisation guard, so the body is never planned and the change under test never runs. That failure comes with successful terminal output backing it up, which is what makes it worse than an unchecked claim.

**Parallel-safety (why the run dir exists):** every artifact this skill touches is timestamped and scoped under `RUN_DIR`, so multiple codex-review sessions — or a fan-out of per-wave reviews — run concurrently without stepping on each other's `PLAN.md`, log, or verdict file. Never write these artifacts to the repo root or to a shared `/tmp` path.

## Flow

### Step 0 — Kickoff (human gate #1)

The invocation itself is the kickoff. Confirm scope in one line: what is being planned. If the user gave no task, ask for it (one question). Then proceed — do NOT ask for approval round-by-round; that comes at the end.

Derive `SLUG` from that one-line scope (2–5 kebab-case words) and create this run's dedicated, timestamped folder before writing anything:

```bash
SLUG="<derived-or-user-provided>"            # e.g. wave5-cleanup
STAMP="$(date +%Y%m%d-%H%M)"
RUN_DIR="docs/codex-review/${SLUG}-${STAMP}"
mkdir -p "$RUN_DIR"
echo "codex-review run dir: $RUN_DIR"          # PLAN_FILE=$RUN_DIR/PLAN.md, LOG_FILE=$RUN_DIR/PLAN-REVIEW-LOG.md, VERDICT_FILE=$RUN_DIR/codex-verdict.txt
```

Everything below writes to `$RUN_DIR`. Never touch repo-root `PLAN.md`/`PLAN-REVIEW-LOG.md` or a shared `/tmp/codex-verdict.txt`.

### Step 1 — Claude plans

Do real planning: read the relevant code, think through the approach, surface decisions and tradeoffs. Then write the plan to `PLAN_FILE` in this structure:

```markdown
# Plan: <task>
_Round 0 — initial draft by Claude_

## Goal
<one paragraph>

## Approach
<numbered steps, concrete>

## Key decisions & tradeoffs
<the contestable choices — name them explicitly so Codex has something to bite>

## Risks / open questions
<what you're unsure about>

## Out of scope
<bounds>
```

Initialize `LOG_FILE`:
```markdown
# Plan Review Log: <task>
Started <stamp the user's local time if known, else "session start">. MAX_ROUNDS=<n>.
```

Show the user the plan inline and say you're sending it to Codex for adversarial review.

### Step 2 — The loop

Maintain `ROUND` (start 1) and `THREAD_ID` (empty until round 1 returns).

**The review prompt** sent to Codex each round (adjust the task line):

> You are an adversarial reviewer for an implementation plan. Be skeptical and specific — your job is to find what breaks, not to be agreeable. Read the plan at `<$PLAN_FILE — substitute the real path, e.g. docs/codex-review/wave5-cleanup-20260720-1530/PLAN.md>` (and any repo files you need; you are read-only). Identify concrete flaws: security holes, race conditions, missing edge cases, schema conflicts, wrong assumptions, observability gaps, simpler alternatives. For each, give a one-line fix. Do NOT modify any files. End your reply with EXACTLY one line: `VERDICT: APPROVED` if the plan is sound enough to implement, or `VERDICT: REVISE` if it still has material problems.

Substitute the real `$PLAN_FILE` path into the prompt before sending — Codex must be pointed at this run's plan inside `$RUN_DIR`, not a bare `PLAN.md`.

**Round 1** (creates the session — capture `thread_id`):

```bash
codex exec -s read-only --json \
  -o "$VERDICT_FILE" \
  "$(cat REVIEW_PROMPT)" \
  2>/dev/null | grep '"type":"thread.started"'
```
Parse `thread_id` from the `{"type":"thread.started","thread_id":"..."}` line → that is `THREAD_ID`. The critique text lands in `$VERDICT_FILE` (Codex's last message). Read that file.

> Note: stderr carries cosmetic MCP/auth noise on some setups — `2>/dev/null` is intentional. Confirm success by the presence of the verdict file + a `thread.started` line. If neither appears, the run failed (auth/model) — stop and tell the user.

**Rounds 2..MAX** (resume the SAME session — Codex remembers its earlier critiques, won't re-litigate settled points):

```bash
# NOTE: resume rejects -s. Force read-only via -c sandbox_mode, or Codex
# inherits config.toml (possibly danger-full-access) and could write files.
codex exec resume "$THREAD_ID" -c sandbox_mode="read-only" --json \
  -o "$VERDICT_FILE" \
  "I revised the plan. Re-review $PLAN_FILE. Same rules. End with VERDICT: APPROVED or VERDICT: REVISE." \
  2>/dev/null >/dev/null
```

Both `codex exec` and `codex exec resume` support `--json` (stream → parse `thread_id` first round) and `-o/--output-last-message` (verdict capture).

**Each round, after Codex returns:**
1. Read `$VERDICT_FILE`. Append to `LOG_FILE`: `## Round <n> — Codex` + the full critique.
2. Grep the last line for the verdict token.
   - `VERDICT: APPROVED` → break the loop, go to Step 3 (converged).
   - `VERDICT: REVISE` → Claude reads the critique, decides **what's actually worth acting on** (Claude has final say — Codex advises, it does not command). Revise `PLAN_FILE`. Append to `LOG_FILE`: `### Claude's response` + what you changed and what you rejected and why. Increment `ROUND`.
3. If `rounds=until-approved` → **never break here.** Run the stall guard (3 consecutive same-objection rounds with an unchanged `PLAN_FILE` → log it, change tactic, continue) and loop again. Otherwise, if `ROUND > MAX_ROUNDS` → break to Step 3 (deadlock).

### Step 3 — Resolution (human gate #2)

**If APPROVED:** Present to the user — the final `PLAN_FILE`, a 3-bullet summary of what the argument improved, and the round count. Ask: *"Plan survived N rounds of Codex. Implement it now?"* Only on a yes does Claude write code. **No code is written during the loop.**

**If MAX_ROUNDS hit without APPROVED (deadlock):** Do NOT pretend it converged. Surface the unresolved disagreements explicitly: list each point Codex still flags and Claude's counter-position. Hand it to the human to break the tie. This is a legitimate, useful outcome — a flagged disagreement beats a false "approved."

**Under `rounds=until-approved` this branch never runs.** There is no deadlock exit and no tie-break to hand over: the loop continues, driven by the stall guard, until Codex returns `VERDICT: APPROVED`. Resolution is reached exactly once, on approval.

## Hard rules

- Codex is read-only EVERY round — `-s read-only` for the first call, `-c sandbox_mode="read-only"` for every resume (resume has no `-s`). It never writes. If you're tempted to give it write access, stop — that's a different skill.
- The loop terminates at `MAX_ROUNDS` — **except** under `rounds=until-approved`, whose whole purpose is to run past it until Codex approves. That mode is deliberate and caller-requested; never enable it on your own initiative, and never disable it once a caller asked for it. In every other mode, no unbounded recursion.
- **Never stop mid-loop to ask permission to keep going.** The round budget is settled at kickoff, from the args. Asking again halfway is the failure mode `rounds=until-approved` exists to prevent.
- Claude is the final arbiter on every REVISE — incorporate good critiques, reject bad ones *with a reason logged*. Don't cave to Codex on everything (that defeats the cross-model check) and don't ignore it (that defeats the point).
- Code only after human gate #2.
- `LOG_FILE` is the deliverable — it tells the whole story of the argument. Keep it complete.

## What NOT to do

- Don't use this to review existing code — that's `/codex:review`.
- Don't pin a `-codex` model variant on ChatGPT-account auth — it 400s.
- Don't skip the log — the argument transcript is the most valuable artifact.
- Don't let Codex edit files. Read-only, always.
