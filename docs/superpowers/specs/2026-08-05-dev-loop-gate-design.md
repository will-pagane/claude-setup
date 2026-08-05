# Dev loop gate segment — design

Status: approved
Date: 2026-08-05

## Purpose

Personal pre-close gate for a worktree: "did I run build/lint/test recently enough
before I consider this done?" Surfaced as one more rotating candidate in the
statusline's line-2 rodízio, alongside modelo/custo, Codex, Git, and Stats.

This started as a broader "mega observability tool" idea (build/lint/test/dev-server
health, actively re-run in the background). That version was rejected on cost grounds
(see Rejected approaches below) and redesigned into a pure read of work already done —
this spec covers only that surviving version.

## What it is NOT

- Not an active health monitor. Nothing is ever spawned, run, or re-triggered by the
  statusline itself.
- Not a substitute for CI. It only reflects what happened inside *this* Claude Code
  session (main transcript + subagent transcripts) via the Bash tool. A command run in
  a separate terminal outside Claude Code is invisible to it — there is no mechanism to
  observe that, and none is in scope here.
- Does not track dev-server console/HMR errors. `devPortSeg` (existing, port-only) is
  unchanged — capturing a dev server's live stdout would require the user to redirect
  it to a log file themselves (`npm run dev 2>&1 | tee ...`), which breaks the
  zero-config bar every other segment in this tool holds itself to. Cut from scope.

## Mechanism

Both the main session transcript and every subagent transcript are already parsed
once per render for `tokenTotals()`/`costTotals()` (usage/cost data). This feature
adds a third pass over the *same* file list, extracting Bash tool calls instead of
usage:

1. **Pair `tool_use` with `tool_result`.** Every Bash `tool_use` content block carries
   `id` and `input.command`. Every `tool_result` content block (on a `role: "user"`
   message) carries the matching `tool_use_id`, `is_error`, and the enclosing JSONL
   line has a top-level `timestamp`. Build a map of `tool_use_id → command` in one
   pass, then resolve each `tool_result` against it — exact pairing, not positional
   guessing (verified against a real transcript; a failed command's `toolUseResult` is
   a bare string `"Error: Exit code N..."` rather than the usual
   `{stdout,stderr,interrupted,...}` object, but the `is_error` flag on the
   `tool_result` content block is the reliable signal either way, so the two shapes of
   `toolUseResult` don't need separate handling).
2. **Classify the command** against three categories by regex, no `package.json`
   read required:
   - `build`: `/\b(npm|pnpm|yarn)\s+(run\s+)?build\b/i` or `/\btsc\b.*--noEmit/i`
   - `lint`: `/\b(npm|pnpm|yarn)\s+(run\s+)?lint\b/i` or `/\beslint\b/i`
   - `test`: `/\b(npm|pnpm|yarn)\s+(run\s+)?test\b/i` or `/\bvitest\b/i` or `/\bjest\b/i`
   A command may match more than one category (e.g. a chained `&&` line) — that's fine,
   each match is recorded independently.
3. **Keep only the most recent match per category**, comparing the ISO-8601
   `timestamp` string (lexically comparable) across *all* scanned files — a subagent
   transcript is not guaranteed to be chronologically after the main one, so "last
   line wins" is wrong; the timestamp comparison must span files, not just be
   last-in-file.
4. **Result per category:** `{ ok: boolean, ts: string } | null` (`null` = never run
   this session).

## Gating and display

The segment is added to `rotateCandidates` only when `inRepo` is true **and**
`package.json` exists at the git toplevel — this keeps it from appearing on
non-JS/TS repos or outside a checkout at all, matching how `devPortSeg` already
scopes itself to "when relevant."

Threshold: **10 minutes** (600000ms), matching the user's own stated personal rule
("build/lint/test precisam ter rodado nos últimos 10 min" before closing a worktree).

| State | Condition | Color | Example |
|---|---|---|---|
| never run | no match this session | dim | `test —` |
| fresh pass | `ok && age <= 10min` | green | `build ✓ 3m atras` |
| stale pass | `ok && age > 10min` | yellow | `lint ✓ 24m atras` |
| failed | `!ok`, any age | red | `test ✗ 8m atras` |

Format (all three, one line, same `sep` as other segments):

```
build ✓ 3m atras  │  lint ✗ 8m atras  │  test — nunca rodado
```

A category stays visible even in the "never run" state — that absence is itself the
useful signal ("you haven't verified this yet"), not noise to hide.

## Data flow

```
render()
  └─ if inRepo && package.json exists at toplevel:
       sessionFiles = [transcript_path, ...subagentTranscripts]   // already computed
       for file in sessionFiles:
         for line in file:
           if Bash tool_use  → record command by id
           if tool_result    → resolve id → command, classify, compare timestamp
       devGateSeg = render 3 categories with color/age
       push devGateSeg onto rotateCandidates
```

No new file I/O beyond what's already read for token/cost totals (same file list) —
no cache file, no lock, no background process. Cost is the marginal parse work of one
more pass over already-open files, same order of magnitude as the existing
token/cost scan.

## Error handling

- Malformed JSON line → skip (existing pattern throughout the script: try/catch per
  line, never abort the whole scan).
- No `transcript_path` in stdin → segment omitted entirely (consistent with how
  other transcript-dependent segments degrade).
- `package.json` missing or unreadable at toplevel → segment omitted (not shown as
  broken — just doesn't apply here).
- A `tool_result` whose `tool_use_id` has no matching recorded Bash `tool_use` (e.g.
  truncated/rotated transcript) → skip that result silently.

## Testing

Since this session's own transcript has no real `npm run build/lint/test` calls to
exercise the parser against (mostly `node --check`, `git`, etc. were run instead),
validation is via synthetic JSONL fixtures shaped exactly like the verified real
structure (`tool_use`/`tool_result` pairing, `is_error`, top-level `timestamp`) rather
than the live transcript. Cases to cover: all-three-never-run, one fresh pass, one
stale pass, one failure, a subagent-only match (main transcript has none, subagent
does — must still surface), and a command matching two categories in one line.

## Rejected approaches (for context, not building)

- **Active background health monitor** (original ask: build/lint/test + dev-server
  errors, periodically re-run). Rejected on real CPU/battery cost: this user runs
  several worktrees concurrently as a matter of course, so a per-worktree background
  timer multiplies — 4-5 worktrees × 3 expensive checks × every few minutes is a
  meaningful, constant background load competing with actual dev work. A
  change-gated variant (only re-check if files changed since last check) was proposed
  as a mitigation but abandoned once the read-only transcript approach above made the
  whole spawn-and-cache mechanism unnecessary.
- **Watch-mode daemon** (`tsc --watch` etc. kept running persistently per worktree).
  Rejected: multiplies the existing orphaned-process risk already documented for
  `devPortSeg` by three (one long-lived process per check per worktree).
- **Dev-server error tailing.** Rejected: no passive way to attach to a dev server's
  stdout after the fact; would require the user to manually redirect output to a log
  file, breaking the zero-config bar the rest of the tool holds itself to.
