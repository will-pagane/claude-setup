#!/usr/bin/env bash
# Encapsulates ONE read-only Codex call with the correct safety flags.
# init:   creates the session, prints THREAD_ID=<id>
# resume: re-reviews PLAN.md in the SAME session, forcing read-only
set -euo pipefail

MODE="${1:-}"
PROMPT_RESUME="I revised the fixes in the same plan file. Re-review it. Same rules. End with VERDICT: APPROVED or VERDICT: REVISE."

case "$MODE" in
  init)
    PLAN_FILE="${2:?plan file}"; VERDICT_OUT="${3:?verdict out}"; CATEGORY="${4:-code}"
    PROMPT_INIT="You are an adversarial reviewer for a set of proposed $CATEGORY fixes written as a plan. Be skeptical and specific. Read the plan at $PLAN_FILE (and any repo files you need; you are read-only). For each fix, find what breaks: wrong root cause, regressions, missing edge cases, unsafe DB/search_path/index changes, concurrency. Give a one-line correction each. Do NOT modify files. End with EXACTLY one line: VERDICT: APPROVED or VERDICT: REVISE."
    OUT=$(codex exec -s read-only --json -o "$VERDICT_OUT" "$PROMPT_INIT" 2>/dev/null || true)
    TID=$(printf '%s\n' "$OUT" | grep -o '"thread_id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//')
    if [ -z "$TID" ]; then echo "CODEX_FAILED" >&2; exit 3; fi
    echo "THREAD_ID=$TID"
    ;;
  resume)
    TID="${2:?thread id}"; VERDICT_OUT="${3:?verdict out}"
    # resume rejects -s; MUST force read-only via -c or it may inherit danger-full-access.
    codex exec resume "$TID" -c sandbox_mode="read-only" --json -o "$VERDICT_OUT" "$PROMPT_RESUME" 2>/dev/null >/dev/null || true
    [ -s "$VERDICT_OUT" ] || { echo "CODEX_FAILED" >&2; exit 3; }
    ;;
  *)
    echo "usage: codex-refine.sh init <PLAN_FILE> <VERDICT_OUT> | resume <THREAD_ID> <VERDICT_OUT>" >&2; exit 2 ;;
esac
