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

1. **Where am I.** `git rev-parse --show-toplevel`, `git branch --show-current`, `git worktree list`. If the current branch is `main`/`master` **and there is no worktree to close**, stop — there is nothing here.
   **But being on the default branch is the correct starting state for an orchestrator closing several branches**, so do not read that stop as an abort. `git worktree list` shows the branches waiting; enter each one (`EnterWorktree` with its path) and run this skill through, once per branch, returning with `ExitWorktree` between them. A session that ran a multi-fork build can close every branch itself — one orchestrator did exactly this for five, in sequence, with no refusal.
   **Inside a worktree, compound bash is refused**: no `cd X && …`, no redirects, no `for` loops, and no `-C` aimed at a different worktree. Every command becomes simple and one per call. Nothing announces this, and it changes how each step below is written.
2. **Base and diff.** `BASE=$(git merge-base HEAD origin/main)`; then `git diff --name-only $BASE...HEAD` and `git status --porcelain`. Record both.
3. **Derive from the diff:**
   - migration files (`supabase/migrations/**` or the project's equivalent),
   - edge/serverless function dirs (`supabase/functions/**`) — plus **every consumer** if a shared module changed, since shared code is bundled, not referenced,
   - generated files the project forbids committing.
4. **Uncommitted work.** Untracked or modified files in the diff scope get committed at Step 5. Files clearly outside the branch's purpose are **left alone** and named in the final report — never swept into the commit.
5. **Collision check.** If the project shares one database/runtime across sessions, run its gate (e.g. `npm run collide`) before applying anything.
6. **Create the ledger** (see below) and one todo per step.

## Step 1 — Verify before anything irreversible

**When a failure's justification may have aged out, prove the merge resolves it without merging.** `git merge-tree --write-tree origin/main <branch>` computes the merged tree and mutates nothing — exit 0 plus the corrected blob in the resulting tree is proof, and it costs no branch state. Observed: a branch's last failing test was justified as "this file is byte-identical to `origin/main`" — true when measured, and falsified when a neighbouring session merged the fix afterwards. `merge-tree` settled it in one command, and the merged default branch then ran clean.



Run the project's full lint, typecheck, build and test suite **yourself** and read the actual output. Red → fix it or stop and report. Never migrate, deploy or merge off a red branch.

## Step 2 — Migrations

**A migration applied before the merge hides from the main checkout.** The CLI's list prints local and remote columns, and the *files* still live on the branch — so everything this run applied shows up **only in the remote column, with the local one blank**. A grep anchored to the local column returns **zero of yours** while happily listing other sessions' work, which reads exactly like *nothing was applied* — and acting on that reading undoes production. One run had **nine** in that state (seven from one spec, two from another). Read the remote column, and cross-check against the branch's own migration files.

**Beware the count that is true of a spec and false of the run.** In that same case a fork reported seven, correct for its own spec and wrong as an answer to "how many did this run apply". A correct value answering a different question than the reader is asking was the single most recurrent failure of that day — when you quote a number, say what it counts.



For every migration file in the inventory, confirm it is actually applied to the target database — `supabase db push` (or the project's equivalent), then confirm against the remote ledger (`supabase migration list --linked`). "It was probably applied earlier in the session" is not confirmation.

A migration file on the branch that is **not** in the remote ledger is a hard stop on the merge.

## Step 3 — Edge functions

For every changed function in the inventory, deploy through the project's wrapper, preserving `verify_jwt`. **Verify by re-downloading and grepping for the change** (`supabase functions download <name>`) — a version bump proves nothing. Run the project's drift check afterwards if it has one.

Note in the ledger that this deploy will likely be **undone by the merge** (Step 8 redeploys).

## Step 4 — Pendings

Collect what the session leaves behind: deferred review findings, cut scope, TODOs added to the diff, verification only a human can do, anything parked with a ruling. Sources are the session ledger and the diff — not recollection.

**When the work was built by someone else — a fork, an earlier session — ask for density explicitly, or the default answer is useless.** Left unasked, a hand-off reports *"found X, deferred"*. Asked in these words, it reports entries that paste straight in. Use the phrasing that worked, close to verbatim:

> *"Send me the parked findings with enough density that I can transcribe them straight into the pendings file without reopening the investigation — file and line, the number you measured and how you measured it, the shape of the fix, and the exposure that stays open meanwhile."*

That request produced **13 items transcribed almost directly** in a five-branch close-out. And require one more field the phrasing above does not cover: **any proof that cannot be reproduced**. An equivalence established before a migration that now makes the old path raise is not re-runnable, and an entry that does not say so sends the next reader chasing a break that is not there.

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

**`gh pr merge` prints nothing on success**, so silence is not evidence either way. Confirm with **`git branch -r --contains <sha>`** rather than `gh pr view --json state`: in a live run the `gh` call was refused by a classifier twice while the git query answered every time. `MERGED` — however you establish it — is the only acceptable state before Step 8.

### Merging `main` into the branch trips a three-step trap, and the middle step looks correct

Hit in a real close-out, worth walking before you meet it:

1. The merge brings a **hook-owned generated file** (typically `types.ts`) into the index, which **drops the gate that normally keeps it off the branch** — the gate only fires on a staged change you made, and this one arrived by merge.
2. `.gitattributes` usually marks that file `merge=ours`, so the "correct" resolution is to keep the branch's version. **This is the step that looks right and is not.**
3. Because the code arriving from `main` calls RPCs the branch's older generated types do not know, keeping the branch version **breaks the build** — a genuine `TS2345`, not an artefact.

The way out is to **regenerate the file locally and never commit it**. Then remember at Step 9 that the tree is now deliberately dirty.

**And there is a fourth step, which is where it actually bites: that repair fixes the branch and breaks `main`.** Because step 1 made `main` an ancestor, merging the branch back carries its **whole tree** — including the stale generated file. `main`'s typecheck then fails on the very RPC the old file never knew. Measured end to end in a real close-out, and the gate's own message had predicted it in writing: *goes stale on the next migration and, via `merge=ours`, clobbers main's copy.* Reading the warning and understanding it as theory was not enough.

**The repair is blocked by two gates closing over the same file** — one refusing non-doc commits on `main`, the other refusing that file on a branch — so no commit is possible without the bypass this skill forbids. **When two gates close over one file, look for the project's own tool that is permitted to cross both, instead of breaching one.** It usually exists: here a dedicated script is by design the only place that regenerates and commits that file, only on `main`, using the bypass deliberately and documented. Note that such a tool may **self-skip** when its usual trigger is absent — this one looks for a migration in the change set, and the damage had come from a merge — so it had to be invoked by hand with a migration path fed to it. Using the sanctioned tool outside its usual trigger is still using it; breaching a gate is not.

## Step 8 — Post-merge sync

The merge changed `main`; production usually needs a second pass.

1. **Redeploy every changed function** through the project's wrapper and re-verify by download. On hosts that redeploy in bulk on a push to `main`, the merge silently reverted the Step 3 deploy. Re-run the drift check.

   **The trigger is *any* push to the default branch, not the merge — a docs-only commit does it.** Measured in one close-out: the deploy reverted **three times**, and the first was **before** the merge, caused by a commit that touched no function at all; ten functions dropped back. It then reverted again on the merge push, and again on the pendings push. So **deploy is the last action after the last push** — running docs → deploy → docs → deploy wastes a full round that docs → docs → deploy avoids.

   **How to tell a revert from your own bug:** download the deployed function and run `git status` on the downloaded file. **Clean** means the deployed bundle is byte-identical to the *old* source on the default branch — that is a revert, not a mistake you made. In that run the forbidden call count in one function went from 0 back to 2, and the clean status is what proved it.

   **And bound the blast radius before treating it as an incident:** hosts revert **code only** — migrations already applied stay applied. So the damage of such a revert is limited to what lives purely in the function. Confirm the two flanks anyway: that no scheduler still points at the reverted function, and that the callers you removed are really gone from the database side.
2. **Regenerate hook-owned generated files** (e.g. `npm run types`) on the main checkout if the schema changed, especially when the merge resolved them `ours`.
3. `git pull origin main` on the main checkout so it reflects the merge.

## Step 9 — Cleanup

Only after Step 7 confirmed `MERGED`.

1. **Leave the worktree first.** You cannot remove the directory you are standing in — `ExitWorktree`, or `cd` to the main checkout. Skipping this is the most common failure of this step.
2. Confirm nothing is stranded: `git log <branch> --not origin/main --oneline` returns empty, and `git -C <worktree> status --porcelain` is clean. Non-empty → **stop and report**; never delete unmerged commits or uncommitted files.
3. `git worktree remove <dir>` → `git branch -d <branch>` (lowercase `-d`, which refuses unmerged work) → `git push origin --delete <branch>`.
4. Confirm: `git worktree list` and `git branch -a` no longer show it.

**`git branch -d` measures against the branch's UPSTREAM, not against `HEAD`** — so on a collapsed topology it refuses a branch that is fully merged:

```
warning: not deleting branch '<A>' that is not yet merged to
         'refs/remotes/origin/<A>', even though it is merged to HEAD
error: the branch '<A>' is not fully merged
```

The remote had frozen behind while the local branch advanced, which never happens when each branch gets its own pull request — the merge moves or deletes the remote — and always happens to a branch that collapsed into a sibling's. **The expensive mistake is reading that refusal as "use `-D`"**, which discards silently if the containment claim was ever wrong. Correct order: prove containment with `git log <branch> --not origin/main` returning empty, **delete the remote ref first**, then `-d` succeeds on its own.

**`git worktree remove` refuses a dirty tree, and Step 7 may have made it dirty on purpose.** The regenerated generated file is left uncommitted deliberately, so this is exactly where the temptation to reach for `--force` appears — and `--force` here discards work without reading it. Instead, `git checkout` the *generated* file (only that one, and only because it is reproducible by a command) and then remove the worktree normally. If anything else is dirty, stop and report: that is the case this step exists to protect.

**A remote branch already deleted by the host is not a failure.** Many forges delete the head branch on merge, so `git push origin --delete` answers `remote ref does not exist`. That is the expected outcome of an already-completed cleanup — confirm with `git branch -r` and move on. **Run `git fetch --prune` before that confirmation**, or `git branch -a` keeps listing `remotes/origin/<branch>` for a while and the cleanup check appears to fail.

**Two shell traps that make a correct result look like a failed command**, both hit while verifying this step:
- **`grep -c` exits 1 when the count is 0.** A compound verification whose whole point is "zero orphan commits" therefore reports failure at the moment it succeeds.
- **Piping a command hands you the pipe's status, not the command's** — see the push confirmation above; the same applies to every check here.

If the session ran directly on the main checkout with no worktree, steps 1 and 3's `worktree remove` simply do not apply — switch to `main` and delete the branch.

## Step 10 — Report

Compose from the ledger, never from memory, in the user's language:

- **Mergeado** — PR number and URL, commit range, what shipped.
- **Aplicado em produção** — migrations applied (+ ledger confirmation), functions deployed (+ how each was verified after the merge).
- **Pendências registradas** — each item written to the pendings file, with its file path.
- **Pendências fechadas** — each item **removed** from the file because this session resolved it. Easy to omit, because the report is built from what you wrote and closing an item leaves nothing to point at — but on a cleanup-heavy branch it can be the larger half of the work. One close-out recorded 13 items opened and said nothing about **17 closed**, until the user asked outright *"didn't you remove the ones you fixed?"* — and had no way to know otherwise.
- **Re-read the pendings file after writing it**, and check whether anything that *survived* was invalidated by this session's own work. The same check that surfaced the omission above also found two stale survivors: one item claiming a property held for "exactly one of ~200 migrations" when the session had made it six, and another conditioned on a ratchet that closed that same day. Your own diff is the most likely thing to have falsified the list you are leaving behind.
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
| "`git branch -d` refuses, so I need `-D`" | `-d` compares against the **upstream**, not `HEAD`. Prove containment, delete the remote ref, then `-d` passes on its own. `-D` would discard silently if you were wrong. |
| "I deployed after the merge, so production is current" | Any later push to the default branch reverts it — a docs-only commit will do. Deploy last, after the last push. |
| "The migration list shows none of mine, so nothing was applied" | Pre-merge migrations appear only in the **remote** column, local blank. Acting on that reading undoes production. |
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
