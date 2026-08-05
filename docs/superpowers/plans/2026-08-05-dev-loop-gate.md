# Dev Loop Gate Segment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only build/lint/test gate-status segment to the statusline's line-2 rodízio, sourced entirely from Bash `tool_use`/`tool_result` pairs already present in the session + subagent transcripts — no background process, no cache file.

**Architecture:** Three new pure functions layered on top of the existing transcript-scanning code in `statusline.mjs`: a shared session+subagent file lister, a per-file scanner that pairs Bash commands with their results and classifies them by regex, and a renderer that turns the merged per-category result into a colored segment string. Wired into `rotateCandidates` only when `inRepo`, `transcript_path` is present, and a `package.json` exists at the git toplevel.

**Tech Stack:** Plain Node.js (no dependencies), single-file script — matches the rest of `statusline.mjs`. No test framework exists for this file; every existing feature is verified by piping crafted synthetic stdin JSON into the real script and inspecting the rendered (ANSI-stripped) output. This plan follows that same convention rather than introducing a new unit-test harness.

## Global Constraints

- Threshold for "fresh" is **exactly 10 minutes** (600000ms) — copied from the spec's stated personal rule.
- Classification regexes (exact, case-insensitive):
  - `build`: `/\b(npm|pnpm|yarn)\s+(run\s+)?build\b/i` or `/\btsc\b.*--noEmit/i`
  - `lint`: `/\b(npm|pnpm|yarn)\s+(run\s+)?lint\b/i` or `/\beslint\b/i`
  - `test`: `/\b(npm|pnpm|yarn)\s+(run\s+)?test\b/i` or `/\bvitest\b/i` or `/\bjest\b/i`
- **No new process is ever spawned, no cache file is ever written** by this feature. It is a pure read of files the script already opens for `tokenTotals()`/`costTotals()`.
- Segment appears only when `inRepo` is true, `J.transcript_path` is present, **and** `package.json` exists at the git toplevel (`top`). Missing any one of the three → segment omitted entirely, never shown broken.
- "Most recent match per category" is compared by the ISO-8601 `timestamp` string across **all** scanned files (main transcript + every subagent transcript) — never "last line in the main file wins" or "first match wins."
- A category that was never run this session still renders (dim `—`), it is not hidden — absence is signal, not noise.
- Edit the live file directly at `/Users/willianpagane/.claude/statusline/statusline.mjs` (this is the file actually loaded by the user's `~/.claude/settings.json` `statusLine.command`) — the `claude-setup` repo clone is a mirror pushed at the end, not the working copy.
- Test fixture timestamps are computed **at fixture-creation time** relative to "now" (`date -u -v-NM ...`), never hardcoded absolute strings — a hardcoded past timestamp silently drifts past the 10-minute freshness threshold depending on when the plan is actually executed, which would make a "fresh" test case flip to "stale" for reasons unrelated to the code under test.

---

### Task 1: Shared file lister, classification patterns, and gate colors

**Files:**
- Modify: `/Users/willianpagane/.claude/statusline/statusline.mjs:61` (COL palette — add two entries)
- Modify: `/Users/willianpagane/.claude/statusline/statusline.mjs:339` (right after `listJsonlRecursive`, before `function tokenTotals()`)

**Interfaces:**
- Consumes: `listJsonlRecursive(dir): string[]` (existing, line 326), `J` (existing global stdin object), `path`/`fs` (existing imports)
- Produces: `sessionAndSubagentFiles(): string[]` — used by Task 2. `DEV_GATE_PATTERNS: {build: RegExp[], lint: RegExp[], test: RegExp[]}` — used by Task 2. `COL.gateFresh`, `COL.gateStale` — used by Task 3 (`COL.warn` already exists, reused for the failed state).

- [ ] **Step 1: Add the two new palette colors**

In `/Users/willianpagane/.claude/statusline/statusline.mjs`, find:

```js
  tokens: 183, // lilas — total de tokens (sessao + sub-agentes)
  warn: 203, // vermelho — modelo sem entrada em MODEL_PRICING
};
```

Replace with:

```js
  tokens: 183, // lilas — total de tokens (sessao + sub-agentes)
  warn: 203, // vermelho — modelo sem entrada em MODEL_PRICING
  gateFresh: 150, // verde — build/lint/test passou dentro do threshold de 10min
  gateStale: 214, // amarelo — passou, mas faz mais de 10min
};
```

- [ ] **Step 2: Add the file lister and pattern table**

In `/Users/willianpagane/.claude/statusline/statusline.mjs`, find:

```js
function listJsonlRecursive(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  let out = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJsonlRecursive(p));
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}
```

Directly after it (before `function tokenTotals() {`), insert:

```js
// Lista transcript da sessao + todo transcript de sub-agente rodado a
// partir dela — mesma "sessao filha" que tokenTotals()/costTotals() ja
// escaneiam, so que aqui pro dev-loop-gate (Task 2). Duplica a logica de
// achar subDir em vez de refatorar tokenTotals/costTotals pra usar isto —
// risco desnecessario mexer em codigo que ja funciona so pra desduplicar
// umas linhas.
function sessionAndSubagentFiles() {
  const transcriptPath = J?.transcript_path;
  const sessionId = J?.session_id;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return [];
  const subDir = path.join(path.dirname(transcriptPath), sessionId, "subagents");
  return [transcriptPath, ...listJsonlRecursive(subDir)];
}

// Classificacao de comando Bash por categoria de gate — regex, sem ler
// package.json. Um comando pode bater em mais de uma categoria (linha
// composta com &&); cada categoria e avaliada independente.
const DEV_GATE_PATTERNS = {
  build: [/\b(npm|pnpm|yarn)\s+(run\s+)?build\b/i, /\btsc\b.*--noEmit/i],
  lint: [/\b(npm|pnpm|yarn)\s+(run\s+)?lint\b/i, /\beslint\b/i],
  test: [/\b(npm|pnpm|yarn)\s+(run\s+)?test\b/i, /\bvitest\b/i, /\bjest\b/i],
};
```

- [ ] **Step 3: Verify syntax**

Run: `node --check "/Users/willianpagane/.claude/statusline/statusline.mjs" && echo SYNTAX_OK`
Expected: `SYNTAX_OK`

- [ ] **Step 4: Smoke-test the file lister against the real current session transcript**

Run:

```bash
TRANSCRIPT="/Users/willianpagane/.claude/projects/-Users-willianpagane-Documents-Claude-Projects-Projeto-Polo-Fenix/6553f342-6658-4b50-a345-98261c6ad846.jsonl"
echo "{\"session_id\":\"6553f342-6658-4b50-a345-98261c6ad846\",\"transcript_path\":\"$TRANSCRIPT\"}" | node -e "
const fs=require('fs');
const path=require('path');
global.J=JSON.parse(fs.readFileSync(0,'utf8'));
const src=fs.readFileSync('/Users/willianpagane/.claude/statusline/statusline.mjs','utf8');
eval(src.match(/function listJsonlRecursive[\s\S]*?\n}\n/)[0]);
eval(src.match(/function sessionAndSubagentFiles[\s\S]*?\n}\n/)[0]);
console.log(sessionAndSubagentFiles().length, 'arquivo(s)');
"
```

Expected: um numero >= 1 impresso (pelo menos o transcript principal).

- [ ] **Step 5: Commit**

O arquivo local `~/.claude/statusline/statusline.mjs` não é seu próprio repositório git — não há commit por task aqui. O commit real acontece uma vez, no Task 4, contra o clone do `claude-setup`, com as mudanças dos Tasks 1-3 juntas.

---

### Task 2: Scanner — pareia tool_use/tool_result, classifica, mescla por timestamp

**Files:**
- Modify: `/Users/willianpagane/.claude/statusline/statusline.mjs` (logo depois do bloco inserido no Task 1, ainda antes de `function tokenTotals()`)

**Interfaces:**
- Consumes: `DEV_GATE_PATTERNS`, `sessionAndSubagentFiles()` (Task 1)
- Produces: `scanDevGateFile(file: string): Record<'build'|'lint'|'test', {ok: boolean, ts: string}>` — usado por `devGateResults()` (nesta mesma task) e por Task 3. `devGateResults(): Record<'build'|'lint'|'test', {ok: boolean, ts: string}>` — usado por Task 3.

- [ ] **Step 1: Verificar que as funcoes ainda nao existem**

```bash
grep -c "function scanDevGateFile\|function devGateResults" "/Users/willianpagane/.claude/statusline/statusline.mjs"
```

Expected: `0`

- [ ] **Step 2: Implementar `scanDevGateFile` e `devGateResults`**

Logo após o bloco `DEV_GATE_PATTERNS` inserido no Task 1 (ainda antes de `function tokenTotals()`), insira:

```js
// Escaneia UM arquivo de transcript: pareia cada tool_use do Bash com seu
// tool_result (por tool_use_id, exato — nao por posicao), classifica o
// comando, e guarda so o match MAIS RECENTE por categoria DENTRO DESTE
// ARQUIVO. A mescla entre arquivos (sessao + cada sub-agente) acontece em
// devGateResults() abaixo, comparando timestamp.
function scanDevGateFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return {};
  }
  const commandById = new Map();
  const best = {};
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const content = d?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (
        block?.type === "tool_use" &&
        block?.name === "Bash" &&
        typeof block?.input?.command === "string"
      ) {
        commandById.set(block.id, block.input.command);
      } else if (block?.type === "tool_result" && block?.tool_use_id) {
        const command = commandById.get(block.tool_use_id);
        const ts = d.timestamp;
        if (!command || !ts) continue;
        const ok = block.is_error !== true;
        for (const [category, patterns] of Object.entries(DEV_GATE_PATTERNS)) {
          if (!patterns.some((re) => re.test(command))) continue;
          if (!best[category] || ts > best[category].ts) {
            best[category] = { ok, ts };
          }
        }
      }
    }
  }
  return best;
}

// Mescla o resultado de scanDevGateFile() atraves de todos os arquivos da
// sessao (principal + sub-agentes) — comparando timestamp, NAO ordem de
// arquivo, porque um sub-agente pode ter rodado depois do ultimo turno
// visivel no transcript principal.
function devGateResults() {
  const merged = {};
  for (const file of sessionAndSubagentFiles()) {
    const fileResult = scanDevGateFile(file);
    for (const [category, result] of Object.entries(fileResult)) {
      if (!merged[category] || result.ts > merged[category].ts) {
        merged[category] = result;
      }
    }
  }
  return merged;
}
```

- [ ] **Step 3: Verificar sintaxe**

Run: `node --check "/Users/willianpagane/.claude/statusline/statusline.mjs" && echo SYNTAX_OK`
Expected: `SYNTAX_OK`

- [ ] **Step 4: Fixture e teste — "nunca rodou" (arquivo sem nenhum comando relevante)**

```bash
mkdir -p /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-fixtures
cat > /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-fixtures/empty.jsonl <<'EOF'
{"type":"assistant","timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_x","name":"Bash","input":{"command":"git status"}}]}}
{"type":"user","timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_x","content":"clean","is_error":false}]}}
EOF
node -e "
const fs=require('fs');
global.J={};
const src=fs.readFileSync('/Users/willianpagane/.claude/statusline/statusline.mjs','utf8');
eval(src.match(/const DEV_GATE_PATTERNS[\s\S]*?\n};\n/)[0]);
eval(src.match(/function scanDevGateFile[\s\S]*?\n}\n/)[0]);
const r = scanDevGateFile('/Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-fixtures/empty.jsonl');
console.log(JSON.stringify(r) === '{}' ? 'PASS vazio' : 'FAIL: ' + JSON.stringify(r));
"
```

Expected: `PASS vazio` — `git status` não bate em nenhuma categoria.

- [ ] **Step 5: Fixture e teste — um comando bate em DUAS categorias**

```bash
cat > /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-fixtures/dual.jsonl <<'EOF'
{"type":"assistant","timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_dual","name":"Bash","input":{"command":"npm run build && npm run lint"}}]}}
{"type":"user","timestamp":"2026-01-01T00:00:05.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_dual","content":"ok","is_error":false}]}}
EOF
node -e "
const fs=require('fs');
global.J={};
const src=fs.readFileSync('/Users/willianpagane/.claude/statusline/statusline.mjs','utf8');
eval(src.match(/const DEV_GATE_PATTERNS[\s\S]*?\n};\n/)[0]);
eval(src.match(/function scanDevGateFile[\s\S]*?\n}\n/)[0]);
const r = scanDevGateFile('/Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-fixtures/dual.jsonl');
const pass = r.build?.ok === true && r.lint?.ok === true && r.test === undefined;
console.log(pass ? 'PASS dual-categoria' : 'FAIL: ' + JSON.stringify(r));
"
```

Expected: `PASS dual-categoria` — o mesmo `tool_result` populou `build` e `lint`, `test` continua ausente.

- [ ] **Step 6: Fixture e teste — "mais recente vence" dentro do mesmo arquivo**

Duas rodadas de `build` no mesmo arquivo: uma antiga que falhou, uma mais nova (gerada com timestamp relativo real, via `date`) que passou. Se o merge pegar a errada, o teste falha.

```bash
T_OLD=$(date -u -v-40M +"%Y-%m-%dT%H:%M:%S.000Z")
T_NEW=$(date -u -v-1M +"%Y-%m-%dT%H:%M:%S.000Z")
cat > /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-fixtures/recency.jsonl <<EOF
{"type":"assistant","timestamp":"$T_OLD","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_old","name":"Bash","input":{"command":"npm run build"}}]}}
{"type":"user","timestamp":"$T_OLD","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_old","content":"3 errors","is_error":true}]}}
{"type":"assistant","timestamp":"$T_NEW","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_new","name":"Bash","input":{"command":"npm run build"}}]}}
{"type":"user","timestamp":"$T_NEW","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_new","content":"ok","is_error":false}]}}
EOF
node -e "
const fs=require('fs');
global.J={};
const src=fs.readFileSync('/Users/willianpagane/.claude/statusline/statusline.mjs','utf8');
eval(src.match(/const DEV_GATE_PATTERNS[\s\S]*?\n};\n/)[0]);
eval(src.match(/function scanDevGateFile[\s\S]*?\n}\n/)[0]);
const r = scanDevGateFile('/Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-fixtures/recency.jsonl');
console.log(r.build?.ok === true ? 'PASS mais-recente-vence' : 'FAIL: ' + JSON.stringify(r));
"
```

Expected: `PASS mais-recente-vence` — se o código pegasse a primeira ocorrência (ou a última do array por engano de comparação), isso viria `false` e o teste pegaria.

- [ ] **Step 7: Fixture e teste — merge cross-file (match só existe no sub-agente)**

```bash
cat > /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-fixtures/crossfile-main.jsonl <<'EOF'
{"type":"assistant","timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_m","name":"Bash","input":{"command":"git status"}}]}}
{"type":"user","timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_m","content":"clean","is_error":false}]}}
EOF
cat > /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-fixtures/crossfile-sub.jsonl <<'EOF'
{"type":"assistant","timestamp":"2026-01-01T00:05:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_s","name":"Bash","input":{"command":"pnpm run test"}}]}}
{"type":"user","timestamp":"2026-01-01T00:05:10.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_s","content":"12 passed","is_error":false}]}}
EOF
node -e "
const fs=require('fs');
global.J={};
const src=fs.readFileSync('/Users/willianpagane/.claude/statusline/statusline.mjs','utf8');
eval(src.match(/const DEV_GATE_PATTERNS[\s\S]*?\n};\n/)[0]);
eval(src.match(/function scanDevGateFile[\s\S]*?\n}\n/)[0]);
eval(src.match(/function devGateResults[\s\S]*?\n}\n/)[0]);
function sessionAndSubagentFiles() {
  return [
    '/Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-fixtures/crossfile-main.jsonl',
    '/Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-fixtures/crossfile-sub.jsonl',
  ];
}
const r = devGateResults();
const pass = r.test?.ok === true && r.build === undefined && r.lint === undefined;
console.log(pass ? 'PASS cross-file' : 'FAIL: ' + JSON.stringify(r));
"
```

Expected: `PASS cross-file` — `test` só existia no arquivo do sub-agente e ainda assim aparece no resultado mesclado.

- [ ] **Step 8: Commit**

Sem commit aqui — mesmo motivo do Task 1. Commit único no Task 4.

---

### Task 3: Renderer + wiring no rodízio

**Files:**
- Modify: `/Users/willianpagane/.claude/statusline/statusline.mjs:655-656` (logo antes de `const rotateCandidates = [segModelCostDur];`)
- Modify: `/Users/willianpagane/.claude/statusline/statusline.mjs:695-702` (dentro do `if (inRepo)`, logo depois do bloco do `devPortSeg`, reaproveitando a variável `top` já calculada ali)
- Modify: `/Users/willianpagane/.claude/statusline/statusline.mjs:2-14` (comentário de topo do arquivo — documentar o novo candidato)

**Interfaces:**
- Consumes: `devGateResults()`, `fmtDur(secs): string`, `COL.gateFresh`, `COL.gateStale`, `COL.warn`, `dim`, `c(n)`, `RESET`, `sep` (todos já existentes ou do Task 1)
- Produces: `DEV_GATE_FRESH_MS = 600000`, `devGateSeg(top: string|null): string|null` — consumido só pela wiring nesta mesma task, nenhuma task futura depende disso.

- [ ] **Step 1: Implementar `devGateSeg`**

Logo antes de `const rotateCandidates = [segModelCostDur];` (linha 656 atual), insira:

```js
const DEV_GATE_FRESH_MS = 10 * 60 * 1000;

// Segmento de gate build/lint/test — so aparece se houver transcript E
// package.json no toplevel (senao nao faz sentido nesse checkout/sessao).
// Categoria nunca rodada nessa sessao continua visivel (cinza "—") de
// proposito: a ausencia e o sinal, nao ruido pra esconder.
function devGateSeg(top) {
  if (!top) return null;
  if (!J?.transcript_path) return null;
  let hasPkg = false;
  try {
    hasPkg = fs.existsSync(path.join(top, "package.json"));
  } catch {
    hasPkg = false;
  }
  if (!hasPkg) return null;

  const results = devGateResults();
  const now = Date.now();
  const parts = ["build", "lint", "test"].map((category) => {
    const r = results[category];
    if (!r) return `${dim}${category} —${RESET}`;
    const ageMs = now - Date.parse(r.ts);
    const ageStr = `${fmtDur(ageMs / 1000)} atras`;
    if (!r.ok) {
      return `${c(COL.warn)}${category} ✗ ${ageStr}${RESET}`;
    }
    const color = ageMs <= DEV_GATE_FRESH_MS ? c(COL.gateFresh) : c(COL.gateStale);
    return `${color}${category} ✓ ${ageStr}${RESET}`;
  });
  return parts.join(`  ${sep}  `);
}
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check "/Users/willianpagane/.claude/statusline/statusline.mjs" && echo SYNTAX_OK`
Expected: `SYNTAX_OK`

- [ ] **Step 3: Wiring — empurrar pro rodizio reaproveitando `top`**

Encontre (dentro do `if (inRepo) {`):

```js
  // ---------- Porta do npm run dev deste checkout (so entra se houver) ----------
  const top = sh("git rev-parse --show-toplevel", cwd);
  const port = devPortSeg(cwd, top);
  if (port) {
    rotateCandidates.push(
      `${dim}dev server${RESET}  ${c(COL.port)}⚡ :${port}${RESET}`
    );
  }
}
```

Substitua por:

```js
  // ---------- Porta do npm run dev deste checkout (so entra se houver) ----------
  const top = sh("git rev-parse --show-toplevel", cwd);
  const port = devPortSeg(cwd, top);
  if (port) {
    rotateCandidates.push(
      `${dim}dev server${RESET}  ${c(COL.port)}⚡ :${port}${RESET}`
    );
  }

  // ---------- Gate build/lint/test (so entra se houver package.json) ----------
  const devGate = devGateSeg(top);
  if (devGate) rotateCandidates.push(devGate);
}
```

- [ ] **Step 4: Atualizar o comentario de topo do arquivo**

Encontre o bloco de comentario que descreve a linha 2 (rodizio), algo como:

```js
//   - Stats: tokens novos gastos (sessao + sub-agentes) · ritmo de burn
//     (fogo vs media historica)
//   Codex/Git/Porta so entram no rodizio dentro de um repo git; Modelo/custo
//   e Stats entram sempre. Rodizio some so se nao sobrar nenhum candidato.
```

Substitua por:

```js
//   - Stats: tokens novos gastos (sessao + sub-agentes) · ritmo de burn
//     (fogo vs media historica)
//   - Gate build/lint/test: le Bash tool_use/tool_result da sessao+sub-agentes
//     (nao roda nada, so observa o que ja rodou) — so entra se houver
//     transcript E package.json no toplevel do repo
//   Codex/Git/Porta/Gate so entram no rodizio dentro de um repo git; Modelo/custo
//   e Stats entram sempre. Rodizio some so se nao sobrar nenhum candidato.
```

- [ ] **Step 5: Verificar sintaxe de novo**

Run: `node --check "/Users/willianpagane/.claude/statusline/statusline.mjs" && echo SYNTAX_OK`
Expected: `SYNTAX_OK`

- [ ] **Step 6: Teste integrado — sem package.json (segmento deve sumir, sem erro)**

```bash
mkdir -p /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-no-pkg
cd /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-no-pkg && git init -q 2>/dev/null
git -C /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-no-pkg commit -q -m init --allow-empty 2>/dev/null
echo '{"session_id":"x","model":{"display_name":"Sonnet 5"},"cost":{"total_cost_usd":1,"total_duration_ms":60000},"workspace":{"current_dir":"/Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-no-pkg","repo":{"name":"no-pkg"}}}' \
  | node "/Users/willianpagane/.claude/statusline/statusline.mjs" > /tmp/devgate-out-nopkg.txt 2>&1
if grep -q "build " /tmp/devgate-out-nopkg.txt; then echo "FAIL: segmento apareceu sem package.json"; else echo "PASS sem-package-json"; fi
node --check "/Users/willianpagane/.claude/statusline/statusline.mjs" && echo "PASS sem erro"
rm -f /tmp/devgate-out-nopkg.txt
```

Expected: `PASS sem-package-json` e `PASS sem erro`.

- [ ] **Step 7: Teste integrado — os 3 estados de cor num único checkout com package.json**

Fixture dedicada, limpa (não reaproveita as fixtures de unidade do Task 2): build fresco (verde), lint falhou (vermelho, idade irrelevante), test no sub-agente só passou há um tempo (amarelo/stale).

```bash
mkdir -p /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-with-pkg
echo '{}' > /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-with-pkg/package.json
cd /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-with-pkg && git init -q 2>/dev/null && git add -A && git commit -q -m init --allow-empty

T_BUILD=$(date -u -v-3M +"%Y-%m-%dT%H:%M:%S.000Z")
T_LINT=$(date -u -v-20M +"%Y-%m-%dT%H:%M:%S.000Z")
T_TEST=$(date -u -v-15M +"%Y-%m-%dT%H:%M:%S.000Z")

mkdir -p /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-fixtures/render-test/subagents
cat > /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-fixtures/render-test/main.jsonl <<EOF
{"type":"assistant","timestamp":"$T_BUILD","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_b","name":"Bash","input":{"command":"npm run build"}}]}}
{"type":"user","timestamp":"$T_BUILD","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_b","content":"ok","is_error":false}]}}
{"type":"assistant","timestamp":"$T_LINT","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_l","name":"Bash","input":{"command":"npm run lint"}}]}}
{"type":"user","timestamp":"$T_LINT","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_l","content":"3 problems","is_error":true}]}}
EOF
cat > /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-fixtures/render-test/subagents/sub1.jsonl <<EOF
{"type":"assistant","timestamp":"$T_TEST","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_t","name":"Bash","input":{"command":"pnpm run test"}}]}}
{"type":"user","timestamp":"$T_TEST","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_t","content":"12 passed","is_error":false}]}}
EOF

TRANSCRIPT="/Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-fixtures/render-test/main.jsonl"
echo "{\"session_id\":\"render-test\",\"model\":{\"display_name\":\"Sonnet 5\"},\"cost\":{\"total_cost_usd\":1,\"total_duration_ms\":60000},\"transcript_path\":\"$TRANSCRIPT\",\"workspace\":{\"current_dir\":\"/Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-with-pkg\",\"repo\":{\"name\":\"with-pkg\"}}}" \
  > /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-fixtures/render-test/stdin.json

for i in 1 2 3 4 5 6; do
  OUT=$(cat /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-fixtures/render-test/stdin.json | node "/Users/willianpagane/.claude/statusline/statusline.mjs" | sed -e 's/\x1b\[[0-9;]*m//g')
  if echo "$OUT" | grep -q "build ✓"; then break; fi
  sleep 1.7
done
echo "$OUT" | grep "build\|lint\|test"
```

Expected (procurar na saída, na ordem que o rodízio trouxer — pode precisar do loop acima pra cair no candidato certo, igual toda feature anterior desse arquivo): `build ✓ 3m atras`, `lint ✗ 20m atras`, `test ✓ 15m atras` — build/test aparecem verde/amarelo respectivamente (cores conferidas antes do `sed` remover o ANSI, se quiser inspecionar visualmente: repita o comando sem o `sed`).

- [ ] **Step 8: Commit**

Sem commit aqui — Task 4 faz o commit único cobrindo Tasks 1-3.

---

### Task 4: Fechar — commit, push pro `claude-setup`, sincronizar cópia local

**Files:**
- Modify: clone temporário de `will-pagane/claude-setup` — `statusline/statusline.mjs` (copiado do arquivo local já editado)
- Já commitados nesta sessão: `docs/superpowers/specs/2026-08-05-dev-loop-gate-design.md`, `docs/superpowers/plans/2026-08-05-dev-loop-gate.md`

**Interfaces:**
- Consumes: nada novo — só empacota o resultado dos Tasks 1-3.
- Produces: nada consumido por task futura — este é o último task do plano.

- [ ] **Step 1: Regressão rápida — confirmar que as features existentes não quebraram**

```bash
node --check "/Users/willianpagane/.claude/statusline/statusline.mjs" && echo SYNTAX_OK
echo '{"session_id":"x","model":{"display_name":"Sonnet 5"},"cost":{"total_cost_usd":1,"total_duration_ms":60000},"context_window":{"used_percentage":10}}' \
  | node "/Users/willianpagane/.claude/statusline/statusline.mjs" | sed -e 's/\x1b\[[0-9;]*m//g'
```

Expected: `SYNTAX_OK` e as duas linhas normais (Claude/context/5h/7d e modelo/custo/duracao) sem erro — sem `transcript_path` nem repo, o gate simplesmente não entra no rodízio (nem quebra).

- [ ] **Step 2: Clonar `claude-setup` fresco, copiar o arquivo editado**

```bash
rm -rf /Users/willianpagane/.claude/jobs/6553f342/tmp/claude-setup-final
cd /Users/willianpagane/.claude/jobs/6553f342/tmp && gh repo clone will-pagane/claude-setup claude-setup-final -- -q
cp /Users/willianpagane/.claude/statusline/statusline.mjs /Users/willianpagane/.claude/jobs/6553f342/tmp/claude-setup-final/statusline/statusline.mjs
cd /Users/willianpagane/.claude/jobs/6553f342/tmp/claude-setup-final && node --check statusline/statusline.mjs && echo SYNTAX_OK
```

Expected: `SYNTAX_OK`

- [ ] **Step 3: Commit e push**

```bash
cd /Users/willianpagane/.claude/jobs/6553f342/tmp/claude-setup-final
git add statusline/statusline.mjs
git commit -m "$(cat <<'EOF'
feat(statusline): add dev loop gate segment (build/lint/test)

Read-only gate checklist sourced from Bash tool_use/tool_result pairs
already present in the session + subagent transcripts -- no background
process, no cache file. Green if passed within 10min, yellow if passed
but stale, red if the last run failed, dim if never run this session.
Only appears when transcript_path is present and package.json exists
at the git toplevel.

Implements docs/superpowers/specs/2026-08-05-dev-loop-gate-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SFxcYFd3Us6R2XVx3BPosS
EOF
)"
git push origin main
git log --oneline -3
```

Expected: push aceito, `git log` mostrando o novo commit no topo.

- [ ] **Step 4: Confirmar CI**

```bash
sleep 10
gh run list --repo will-pagane/claude-setup --limit 1 --json conclusion,status,url --jq '.[0]'
```

Expected: `"conclusion":"success","status":"completed"`

- [ ] **Step 5: Limpeza das fixtures temporárias**

```bash
rm -rf /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-fixtures /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-no-pkg /Users/willianpagane/.claude/jobs/6553f342/tmp/devgate-with-pkg /Users/willianpagane/.claude/jobs/6553f342/tmp/claude-setup-final
```
