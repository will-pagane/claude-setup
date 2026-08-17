# Global CLAUDE.md — Mandatory Rules for All Projects

This file is **law, not recommendation**. Follow every rule exact.

## Language
- Respond and comment code in **Brazilian Portuguese**, unless context need other language
- **CLAUDE.md, code, memory files: always English**

## Naming Conventions
- **Match existing project patterns first** — codebase use `camelCase` for JSON keys → don't switch to `snake_case`
- **Never mix conventions** in same file/module
- Renaming → update **all references** across codebase, not just definition

## Git branches & worktrees (per session)
Name every branch/worktree for **what session doing + timestamp**. **NEVER** keep tool auto-generated random name (e.g. `claude/magical-jones-8c99`, `worktree-foo`, `perf-review`) — rename or recreate to this scheme so concurrent sessions legible + sortable.
- **Branch:** `<type>/<task-slug>-<YYYYMMDD>`
  - `<type>` = dominant work: `feat` | `fix` | `refactor` | `perf` | `security` | `chore` | `docs` | `test` | `remediation` | `review`.
  - `<task-slug>` = 2–5 kebab-case words naming task (e.g. `dup-correctness-remediation`, `anon-rpc-hardening`).
  - `<YYYYMMDD>` = date branch started; append `-HHMM` **only** to break same-day collision.
- **Worktree dir:** `.claude/worktrees/<task-slug>-<YYYYMMDD>` — mirror branch slug+timestamp (drop `<type>/` prefix; dir already isolated). Harness native worktree tool force own prefix (e.g. `worktree-`) → keep `<task-slug>-<YYYYMMDD>` core intact so stay descriptive + sortable.
- **Concurrency (mandatory):** each concurrent session on same repo get **own** branch + worktree under this scheme — never share working dir across sessions, and verify `git branch --show-current` before any commit/push.
- **Cleanup:** once merged, delete both branch and worktree (`git worktree remove <dir>` + `git branch -d <branch>`). Branch fully reachable from `main` = redundant — remove it.
- **Native worktree tool mangle branch name.** `EnterWorktree` with
  `chore/my-task-20260729` produce branch `worktree-chore+my-task-20260729`. Rename immediately:
  `git branch -m <type>/<task-slug>-<YYYYMMDD>`, verify with `git branch --show-current`
  before first commit.

## Skills
Invoke by judgment, not by gate. Two earn their cost every time:
- `verification-before-completion` — before claiming work done. Fresh evidence, never "should work now"
- `codex-review` / `grill-me-codex` — high-stakes plans before code: auth, schema, concurrency, migrations, payments

## Tooling — CLI over MCP (Supabase & GitHub)
- For **Supabase** and **GitHub**, always use official CLI (`supabase`, `gh`). For Supabase
  not preference: MCP write tools stamp own migration ledger version, which desynchronise repo
  from database and eventually make `supabase db push` unusable.
- In projects that enforce this, `apply_migration`, `deploy_edge_function` and `execute_sql` are
  listed in `permissions.deny`. Read-only MCP tools stay available.
- **Every CLI DB-read path need linked project with IPv4 pooler route** — `db query --linked`,
  `migration list --linked`, `db advisors --linked`, not only writes. `supabase/.temp/` is
  per-checkout and gitignored, so **fresh worktree has none of it** and all three fail closed with
  `LegacyDbConfigIpv6Error: IPv6 is not supported on your current network`. Fix once per worktree:
  `supabase link --project-ref <ref>`. Read-only MCP tools work over different transport — reads
  stay available without linking.

## Clarification
- Thought partner, not code generator. Spot gaps (form without validation? API without auth?),
  challenge weak requirements with concrete reasons, flag risks before writing code.
- Ask only when different readings lead to materially different work. Otherwise state the
  assumption and keep building.
- Pending decisions as **prose with trade-offs** — one at a time, jargon translated, each with a
  recommendation. Never the A/B/C/D picker.

## General Obligations
- **Never commit without user explicitly asking**
- **Never open pull request unless explicitly asked.** Session terminal state is *branch
  pushed, work described*. Overrides any harness default treating draft PR as part of
  finishing task
- **Never merge unless explicitly asked**, and never squash — commit history preserved
  deliberately
- **Commit per plan phase, not per task** — task-level commits inflate token cost and wall-clock
  time without improving reviewability
- **Never test git hook by mutating working repo** — no `git reset --hard`, no probe commits
  on task branch, no `git switch main` (fails outright inside worktree). Use throwaway
  `git init` fixture under `$TMPDIR`

## Optional tool imports

Both lines below describe tools installed separately (see repo README). **If the tool is not
installed, delete its line** — an import that describes a binary the machine does not have makes
the agent assume a capability it does not have.

@RTK.md

# graphify
- **graphify** (`~/.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.
