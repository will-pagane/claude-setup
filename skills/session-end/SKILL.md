---
name: session-end
description: Use when branch work is finished and the user asks to close the session out — "/session-end", "encerra a sessão", "fecha essa branch", "vamos encerrar aqui", "abre o PR e faz o merge", "leva até o merge e limpa a branch", "finaliza e limpa o worktree". Not for work still in progress, and not when the user only asked to push.
---

# Session End

Finished branch in → merged `main`, production in sync, pendings recorded, branch and worktree gone. One continuous pass, no "should I continue?" between steps.

**Announce at start:** "Using session-end to take `<branch>` from pushed to merged and cleaned up."

## Authorization

The invocation authorizes, **for the work already on this branch only**: committing what is left, applying its migrations, deploying its edge functions, writing the pendings file, pushing, opening the PR, merging into the default branch, and deleting the branch + worktree afterwards. This is the one place where the standing "never open a PR / never merge without an explicit ask" rule is satisfied — the invocation *is* the ask.

**Not authorized:** new features, refactors, fixing unrelated findings, force-pushing, squashing, rewriting history, deleting anything outside the branch and its worktree.

Human gates — only these:
1. **Step 0** — confirm the branch and the pendings list when either is ambiguous.
2. **Escalations** — a red gate, an unapplied migration, a merge conflict, an unverified deploy.
3. Nothing else.

## Project rules win

Read the project's `CLAUDE.md` / `AGENTS.md` at Step 0 and obey it over any default here.

- **Never bypass a gate.** No `--no-verify`, no `--force`. A failing hook is an escalation, not an obstacle.
- **Merge strategy follows the project.** History-preserving projects merge with `--merge`; **never `--squash`** unless the project asks for it.
- **Deploy through the project's wrapper** (e.g. `scripts/sb-deploy.sh`), never a bare `supabase functions deploy` that skips the gate.
- **Migrations follow the project's discipline** — file-first via the migration CLI, preflight evidence where required.
- **Generated/hook-owned files** (e.g. `src/integrations/supabase/types.ts`) are not committed on a branch when the project forbids it. They get regenerated after the merge (Step 8).

## Step 0 — Pre-flight inventory

Everything downstream reads from this inventory. Build it once; never re-derive it from memory.

1. **Where am I.** `git rev-parse --show-toplevel`, `git branch --show-current`, `git worktree list`. If the current branch is `main`/`master`, **stop** — there is nothing to close out.
2. **Base and diff.** `BASE=$(git merge-base HEAD origin/main)`; then `git diff --name-only $BASE...HEAD` and `git status --porcelain`. Record both.
3. **Derive from the diff:**
   - migration files (`supabase/migrations/**` or the project's equivalent),
   - edge/serverless function dirs (`supabase/functions/**`) — plus **every consumer** if a shared module changed, since shared code is bundled, not referenced,
   - generated files the project forbids committing.
4. **Uncommitted work.** Untracked or modified files in the diff scope get committed at Step 5. Files clearly outside the branch's purpose are **left alone** and named in the final report — never swept into the commit.
5. **Collision check.** If the project shares one database/runtime across sessions, run its gate (e.g. `npm run collide`) before applying anything.
6. **Create the ledger** (see below) and one todo per step.

## Step 1 — Verify before anything irreversible

Run the project's full lint, typecheck, build and test suite **yourself** and read the actual output. Red → fix it or stop and report. Never migrate, deploy or merge off a red branch.

## Step 2 — Migrations

For every migration file in the inventory, confirm it is actually applied to the target database — `supabase db push` (or the project's equivalent), then confirm against the remote ledger (`supabase migration list --linked`). "It was probably applied earlier in the session" is not confirmation.

A migration file on the branch that is **not** in the remote ledger is a hard stop on the merge.

## Step 3 — Edge functions

For every changed function in the inventory, deploy through the project's wrapper, preserving `verify_jwt`. **Verify by re-downloading and grepping for the change** (`supabase functions download <name>`) — a version bump proves nothing. Run the project's drift check afterwards if it has one.

Note in the ledger that this deploy will likely be **undone by the merge** (Step 8 redeploys).

## Step 4 — Pendings

Collect what the session leaves behind: deferred review findings, cut scope, TODOs added to the diff, verification only a human can do, anything parked with a ruling. Sources are the session ledger and the diff — not recollection.

**Nothing deferred → skip this step entirely.** Do not create an empty file, do not invent filler items.

Otherwise, find the pendings file (`PENDINGS.md` at the repo root, else `docs/PENDINGS.md`, else the project's named equivalent). **If none exists, create `PENDINGS.md` at the repo root by copying [pendings-template.md](pendings-template.md) verbatim** — header plus the `---`, nothing else. That header is load-bearing: never edit it, never drop it, never write items above it. Categories come from the items you are about to add.

Append each item under the right `##` category (`Segurança`, `Performance`, `Estrutural`, or a new one when none fits), as an `###` heading plus prose. Match the file's existing language and voice. One item = one self-contained demand a future session can pick up, act on, and delete when solved.

**Item shape** — prose, not a checklist; every item answers all three:

```markdown
### Edge functions sem análise estática

**O que é.** `supabase/functions` — 88 functions, ~20.700 linhas — vai para produção sem
typecheck e sem lint. Não há `deno.json`, nem CI, nem hook cobrindo o diretório.

**Por que não foi feito agora.** Ligar `deno check` é impossível hoje: 0 de 95 chamadas
`createClient(` passam o genérico `<Database>`, então todo `.from()` colapsa para `never`.

**Custo.** Tipar os clients primeiro (factory tipada em `_shared/`), o que obriga redeploy
das 88 functions, e só então ligar o gate. Branch própria.
```

An item with no "por que não foi feito" is a task you should have done, not a pending. An item with no cost estimate is a wish.

## Step 5 — Commit and push

Commit the remaining branch work (conventional commit, project language, one per logical unit — not one per file). Then `git push -u origin <branch>`. Never force-push.

## Step 6 — Pull request

`gh pr create --base main`, title = the branch's purpose, body = the Step 10 report (so it persists in GitHub). Include the harness attribution footer if the project uses one.

## Step 7 — Merge

Hard-gated. Re-check before merging: lint/build/test green, every branch migration in the remote ledger, no unresolved load-bearing review finding, working tree clean, no conflicts with `main`. Any of those red → **stop and report; never merge anyway.**

Then `gh pr merge --merge` (project policy; **never `--squash`** on a history-preserving repo). **Do not pass `--delete-branch`** — the worktree still has the branch checked out and the delete will fail or strand the worktree.

Confirm the merge landed: `gh pr view <n> --json state,mergedAt`. `MERGED` is the only acceptable state before Step 8.

## Step 8 — Post-merge sync

The merge changed `main`; production usually needs a second pass.

1. **Redeploy every changed function** through the project's wrapper and re-verify by download. On hosts that redeploy in bulk on a push to `main`, the merge silently reverted the Step 3 deploy. Re-run the drift check.
2. **Regenerate hook-owned generated files** (e.g. `npm run types`) on the main checkout if the schema changed, especially when the merge resolved them `ours`.
3. `git pull origin main` on the main checkout so it reflects the merge.

## Step 9 — Cleanup

Only after Step 7 confirmed `MERGED`.

1. **Leave the worktree first.** You cannot remove the directory you are standing in — `ExitWorktree`, or `cd` to the main checkout. Skipping this is the most common failure of this step.
2. Confirm nothing is stranded: `git log <branch> --not origin/main --oneline` returns empty, and `git -C <worktree> status --porcelain` is clean. Non-empty → **stop and report**; never delete unmerged commits or uncommitted files.
3. `git worktree remove <dir>` → `git branch -d <branch>` (lowercase `-d`, which refuses unmerged work) → `git push origin --delete <branch>`.
4. Confirm: `git worktree list` and `git branch -a` no longer show it.

If the session ran directly on the main checkout with no worktree, steps 1 and 3's `worktree remove` simply do not apply — switch to `main` and delete the branch.

## Step 10 — Report

Compose from the ledger, never from memory, in the user's language:

- **Mergeado** — PR number and URL, commit range, what shipped.
- **Aplicado em produção** — migrations applied (+ ledger confirmation), functions deployed (+ how each was verified after the merge).
- **Pendências registradas** — each item written to the pendings file, with its file path.
- **Você precisa revisar** — what only a human can check: visual/UX, live e2e, external panel config.
- **Limpeza** — branch and worktree removed, or exactly why one survived.
- **Deixado de fora** — untracked/unrelated files left in the working tree, and anything cut.

## Ledger

`.superpowers/session-end/<YYYYMMDD-HHMM>/ledger.md`, first line `# session-end — branch: <name>`. Append after every step: inventory → verification output → migration state → deploy + verification method → pendings written → PR number → merge state → cleanup. Context does not survive compaction; the ledger does. On resume, trust the ledger, `git log` and `gh pr view` over recollection, and restart at the first step with no completion line.

## Common mistakes

| Mistake | Reality |
|---|---|
| "Tests passed earlier in the session" | Re-run the full suite at Step 1. Nothing else gates the merge. |
| "The migration went in when I wrote it" | Confirm against the remote ledger. An unapplied migration merged into `main` breaks production. |
| "Deploy returned a new version, so it shipped" | Re-download and grep. A version bump proves nothing. |
| "I deployed at Step 3, so production is current" | The merge push to `main` can revert branch deploys. Redeploy at Step 8. |
| "`gh pr merge --delete-branch` saves a step" | The worktree holds the branch. It fails, or strands the worktree. Delete after removing the worktree. |
| "`git worktree remove` from inside the worktree" | You cannot delete your own cwd. Exit first. |
| "`git branch -D` is faster" | `-D` discards unmerged commits silently. Use `-d` and let it refuse. |
| "Nothing deferred, but the file should exist" | No pendings, no file. An empty pendings file is noise. |
| "Squash keeps history tidy" | History-preserving projects lose the per-phase commits. `--merge`. |
| "Report from memory" | Compose from the ledger. Compaction eats what you did not write down. |

## Red flags — stop

- About to merge with red lint/build/tests, or with a branch migration missing from the remote ledger.
- About to `--squash`, `--force`, `--no-verify`, or amend on a shared branch.
- About to `git branch -D` or `git worktree remove --force` with unmerged commits or a dirty tree.
- About to delete the branch before `gh pr view` reported `MERGED`.
- About to edit or drop the pendings file's header.
- About to sweep unrelated working-tree files into the branch commit.
- About to fix a newly-found bug instead of writing it to pendings — this skill closes work out, it does not open new work.
