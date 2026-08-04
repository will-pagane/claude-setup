#!/usr/bin/env node
// Fenix statusline — custom multi-linha para Claude Code.
// Linha 1: "Claude" (laranja) · Context(barra+tokens) · Sessao 5h · Sessao 7d
// Linha 2: modelo (laranja) · custo "$USD - R$BRL" · duracao (ativo/total) · ritmo (fogo 1-3x vs media historica)
// Linha 3: "Codex" (azul fixo) · uso semanal (explicativo, barra branca)
// Linha 4: repo · branch · worktree · files do checkout
// Linha 5: porta do dev server (npm run dev / vite) deste checkout especifico
//          — so aparece quando ha um rodando, senao a linha some
// Uma regua fina separa cada linha, inclusive depois da ultima.
// Sem badge caveman (modo caveman segue ativo via hook + flag .caveman-active).
//
// Fontes de dados:
//   - stdin JSON do Claude Code: model, context_window, rate_limits(5h/7d), cost, workspace.repo
//   - ~/.codex/sessions/**/rollout-*.jsonl: rate_limits do Codex (janela weekly)
//   - open.er-api.com: cotacao USD->BRL, cacheada 12h em disco, com fallback
//   - git: branch, worktree, arquivos modificados

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const HOME = os.homedir();

// ---------- ANSI ----------
const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const c = (n) => `${ESC}38;5;${n}m`;
const rgb = (r, g, b) => `${ESC}38;2;${r};${g};${b}m`;
const bold = `${ESC}1m`;
const dim = c(245);
const white = c(15);
const sep = `${c(238)}│${RESET}`;

function rule() {
  const width =
    process.stdout.columns || Number(process.env.COLUMNS) || 80;
  return `${c(236)}${"─".repeat(Math.max(10, width))}${RESET}`;
}

// paleta
const COL = {
  claude: 208, // laranja — palavra "Claude" e o nome do modelo
  codexLabel: 111, // azul suave, fixo — palavra "Codex" (nao acompanha COL.claude)
  h5: 79, // teal
  d7: 79,
  repo: 116, // azul-claro
  branch: 141, // roxo
  worktree: 108, // verde-cinza
  files: 179, // areia
  port: 214, // laranja-claro
  cost: 150, // verde-claro (USD)
  costBrl: 114, // verde-azulado (BRL)
  dur: 109, // azul-piscina
};

// gradiente de cor por percentual, em degraus de 10%: verde -> amarelo -> vermelho
function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [
    Math.round(255 * f(0)),
    Math.round(255 * f(8)),
    Math.round(255 * f(4)),
  ];
}
function pctColorSeq(p) {
  p = Math.max(0, Math.min(100, Number(p) || 0));
  const bucket = Math.min(10, Math.floor(p / 10)); // 0..10, degrau de 10%
  const t = bucket / 10;
  const hue = 110 - 110 * t; // 110=verde -> 55=amarelo -> 0=vermelho
  const [r, g, b] = hslToRgb(hue, 55, 55);
  return rgb(r, g, b);
}

// barra em blocos inteiros — colorSeq ja e um escape ANSI pronto.
// Sem glifo fracionario de oitavo: aquele caractere parcial deixa parte da
// propria celula sem nenhuma cor pintada, e o fundo que aparece ali depende
// do terminal (tema claro/escuro, cor custom) — vira buraco preto ou mancha
// cinza destoante dependendo do caso. Bloco inteiro nunca tem essa brecha.
function bar(pct, width, colorSeq) {
  pct = Math.max(0, Math.min(100, Number(pct) || 0));
  const whole = Math.round((pct / 100) * width);
  const s =
    colorSeq +
    "█".repeat(whole) +
    c(250) +
    "░".repeat(Math.max(0, width - whole)) +
    RESET;
  return s;
}

function fmtTokens(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return Math.round(n / 1000) + "k";
  return String(n);
}

function fmtDur(secs) {
  secs = Math.max(0, Math.floor(secs));
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

function sh(cmd, cwd) {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    }).trim();
  } catch {
    return "";
  }
}

// Porta(s) do dev server (`npm run dev` -> vite) deste checkout especifico
// (principal ou worktree). Sem registro estatico de porta por worktree
// (vite.config fixa 8080 e autoincrementa se ocupada), entao a unica fonte
// confiavel e perguntar ao SO: processo `node` escutando TCP, com cwd exato
// igual ao toplevel deste checkout, E linha de comando contendo "vite" —
// so cwd bateria com qualquer processo node solto na mesma pasta (ex.: o
// live-server do Impeccable), entao o filtro de comando evita falso-positivo.
function devPortSeg(cwd, top) {
  if (!top) return null;
  const raw = sh("lsof -a -nP -iTCP -sTCP:LISTEN -c node -Fpn", cwd);
  if (!raw) return null;
  const portsByPid = {};
  let pid = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("p")) pid = line.slice(1);
    else if (line.startsWith("n") && pid) {
      const mm = line.match(/:(\d+)$/);
      if (mm) (portsByPid[pid] ??= new Set()).add(mm[1]);
    }
  }
  // Mais de um processo pode ter cwd == toplevel (ex.: dev server orfao de
  // sessao anterior que nunca foi morto) — junta todas as portas casadas em
  // vez de retornar so a primeira, pra isso ficar visivel em vez de escondido.
  const matched = new Set();
  for (const candidatePid of Object.keys(portsByPid)) {
    if (!/^\d+$/.test(candidatePid)) continue;
    const cwdOut = sh(`lsof -a -p ${candidatePid} -d cwd -Fn`, cwd);
    const dirLine = cwdOut.split("\n").find((l) => l.startsWith("n"));
    const dir = dirLine ? dirLine.slice(1) : "";
    // match exato, nao prefixo: um worktree linked vive fisicamente dentro
    // de .claude/worktrees/ do checkout principal, entao startsWith(top+"/")
    // faria a porta de um worktree vazar pro checkout principal.
    if (dir !== top) continue;
    const command = sh(`ps -o command= -p ${candidatePid}`, cwd);
    if (!/vite/i.test(command)) continue;
    for (const p of portsByPid[candidatePid]) matched.add(p);
  }
  if (matched.size === 0) return null;
  return [...matched].sort((a, b) => a - b).join(",");
}

// ---------- ler stdin ----------
let raw = "";
try {
  raw = fs.readFileSync(0, "utf8");
} catch {}
let J = {};
try {
  J = JSON.parse(raw || "{}");
} catch {}

const cwd = J?.workspace?.current_dir || J?.cwd || process.cwd();
const nowSec = Math.floor(Date.now() / 1000);
const inRepo = sh("git rev-parse --is-inside-work-tree", cwd) === "true";

// ---------- LINHA 1 ("Claude" · context · 5h · 7d) ----------
const segClaude = `${bold}${c(COL.claude)}Claude${RESET}`;

// Context (barra + tokens)
const ctx = J?.context_window || {};
const ctxPct = ctx.used_percentage != null ? ctx.used_percentage : 0;
const ctxTok = ctx.total_input_tokens != null ? ctx.total_input_tokens : 0;
const ctxSize = ctx.context_window_size || 0;
const ctxTokStr = ctxSize
  ? `${fmtTokens(ctxTok)}/${fmtTokens(ctxSize)}`
  : fmtTokens(ctxTok);
const segCtx =
  `${dim}context${RESET} ${bar(ctxPct, 8, pctColorSeq(ctxPct))} ` +
  `${pctColorSeq(ctxPct)}${Math.round(ctxPct)}%${RESET} ${dim}${ctxTokStr}${RESET}`;

// helper barra de uso com reset
function usageSeg(label, labelColor, obj) {
  if (!obj || obj.used_percentage == null) {
    return `${c(labelColor)}${label}${RESET} ${dim}—${RESET}`;
  }
  const p = obj.used_percentage;
  let out =
    `${c(labelColor)}${label}${RESET} ${bar(p, 7, pctColorSeq(p))} ` +
    `${pctColorSeq(p)}${Math.round(p)}%${RESET}`;
  if (obj.resets_at) {
    const left = obj.resets_at - nowSec;
    if (left > 0) out += ` ${dim}↺${fmtDur(left)}${RESET}`;
  }
  return out;
}

const seg5h = usageSeg("5h", COL.h5, J?.rate_limits?.five_hour);
const seg7d = usageSeg("7d", COL.d7, J?.rate_limits?.seven_day);

const line1 = [segClaude, segCtx, seg5h, seg7d].join(`  ${sep}  `);

// ---------- LINHA 2 (modelo · custo "$USD - R$BRL" · duracao ativo/total) ----------
const modelName = J?.model?.display_name || J?.model?.id || "?";
const segModelName = `${bold}${c(COL.claude)}◆ ${modelName}${RESET}`;

const costUsd = J?.cost?.total_cost_usd;
const durMs = J?.cost?.total_duration_ms;

// Tempo ativo = soma de todo evento "turn_duration" no transcript da sessao,
// SEM filtrar isSidechain — inclui turnos rodados por subagentes (Task/Agent),
// nao so o loop principal. cost.total_api_duration_ms conta so o loop
// principal, por isso nao serve mais aqui; fica so como fallback se o
// transcript nao existir/nao tiver essas entradas ainda.
function computeActiveMs() {
  const transcriptPath = J?.transcript_path;
  if (transcriptPath && fs.existsSync(transcriptPath)) {
    const out = sh(
      `grep -F '"subtype":"turn_duration"' "${transcriptPath}" | grep -oE '"durationMs":[0-9]+' | awk -F: '{s+=$2} END {print s+0}'`
    );
    const sum = Number(out);
    if (sum > 0) return sum;
  }
  return J?.cost?.total_api_duration_ms ?? null;
}
const activeMs = computeActiveMs();

const segDur =
  durMs != null
    ? `${c(COL.dur)}⏱ ${
        activeMs != null
          ? `${fmtDur(activeMs / 1000)} ativo / ${fmtDur(durMs / 1000)} total`
          : fmtDur(durMs / 1000)
      }${RESET}`
    : `${dim}⏱ —${RESET}`;

// Cotacao USD->BRL, cache 12h em disco (open.er-api.com, sem chave, gratuito)
function usdToBrlRate() {
  const cacheFile = path.join(HOME, ".claude", "statusline", ".fxrate.cache");
  const FALLBACK = 5.3; // usado so se nunca houve fetch bem-sucedido
  let cached = null;
  try {
    cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  } catch {}
  if (cached && (Date.now() - cached.ts) / 1000 < 43200) {
    return { rate: cached.rate, stale: false };
  }
  const out = sh(
    `curl -s -m 1.5 "https://open.er-api.com/v6/latest/USD"`
  );
  if (out) {
    try {
      const j = JSON.parse(out);
      const r = j?.rates?.BRL;
      if (typeof r === "number") {
        try {
          fs.writeFileSync(
            cacheFile,
            JSON.stringify({ rate: r, ts: Date.now() })
          );
        } catch {}
        return { rate: r, stale: false };
      }
    } catch {}
  }
  // fetch falhou — usa cache antigo se existir, senao o fallback fixo
  if (cached) return { rate: cached.rate, stale: true };
  return { rate: FALLBACK, stale: true };
}

const segCost = (() => {
  if (costUsd == null) return `${dim}custo${RESET} ${dim}—${RESET}`;
  const { rate, stale } = usdToBrlRate();
  const brl = (costUsd * rate).toFixed(2);
  return (
    `${dim}custo${RESET} ${c(COL.cost)}$${costUsd.toFixed(2)}${RESET}` +
    `${dim} - ${RESET}` +
    `${c(COL.costBrl)}R$${brl}${RESET}${stale ? ` ${dim}~${RESET}` : ""}`
  );
})();

// Ritmo de burn: tokens de contexto acumulados por minuto ativo — nao custo.
// Dois sinais combinados, o maior vence:
//   1) ratio vs media historica (tokens/min desta sessao / tokens/min medio
//      de outras sessoes) — log local em jsonl, uma linha por sessao (upsert
//      por session_id), podado pra 30 dias / 500 sessoes a cada escrita.
//      So entra em jogo com >=3 sessoes historicas de >=1min ativo, senao
//      baseline fraca vira ruido.
//   2) piso pelo % de contexto cheio (ctxPct) — sobe o fogo mesmo sem
//      historico, porque contexto quase estourando e um risco por si so
//      (compact iminente), independente do ritmo estar "normal".
// Precisa de >=30s ativo na sessao atual pra qualquer leitura fazer sentido.
function burnPaceSeg() {
  const sessionId = J?.session_id;
  if (!sessionId || activeMs == null || activeMs < 30000) return null;
  if (!ctxSize) return null; // sem tamanho de janela nao da pra medir % cheio

  const logFile = path.join(HOME, ".claude", "statusline", ".burn-log.jsonl");
  const now = Date.now();
  const map = new Map();
  try {
    const raw = fs.readFileSync(logFile, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec?.session_id) map.set(rec.session_id, rec);
      } catch {}
    }
  } catch {}

  // Ritmo marginal (delta desde o ultimo render deste MESMO session_id) com
  // suavizacao EMA — pro ETA de handoff usar o ritmo RECENTE, nao a media
  // desde o inicio da sessao. Media-desde-o-inicio conflita a carga fixa e
  // unica de contexto (system prompt + CLAUDE.md, que entra de uma vez logo
  // no primeiro turno) com o crescimento real por turno: sessao jovem tem
  // essa carga ainda "concentrada" no denominador pequeno de tempo ativo, o
  // que infla a taxa e encolhe o ETA — mesmo tendo mais espaco livre que uma
  // sessao antiga que ja diluiu aquele pico inicial ao longo de horas.
  const prevRec = map.get(sessionId) || null;
  const MIN_DELTA_ACTIVE_MS = 20000; // exige >=20s ativo novo pra amostrar de novo
  let rateEma = prevRec?.rate_ema ?? null;
  if (prevRec) {
    const deltaTokens = ctxTok - (prevRec.tokens ?? ctxTok);
    const deltaActiveMs = activeMs - (prevRec.active_ms ?? activeMs);
    // deltaTokens < 0 acontece apos /compact (contexto encolheu) — pula a
    // amostra em vez de deixar isso virar um "ritmo negativo".
    if (deltaTokens >= 0 && deltaActiveMs >= MIN_DELTA_ACTIVE_MS) {
      const instRate = deltaTokens / (deltaActiveMs / 60000);
      rateEma = rateEma == null ? instRate : 0.3 * instRate + 0.7 * rateEma;
    }
  }
  if (rateEma == null) {
    // primeiro render da sessao, sem delta ainda pra medir — usa a media
    // acumulada soh como semente inicial; a partir do proximo render o EMA
    // marginal assume e corrige o vies.
    rateEma = activeMs > 0 ? ctxTok / (activeMs / 60000) : 0;
  }

  map.set(sessionId, {
    session_id: sessionId,
    tokens: ctxTok,
    active_ms: activeMs,
    rate_ema: rateEma,
    ts: now,
  });

  const CUTOFF_MS = 30 * 86400000;
  let entries = [...map.values()].filter((r) => now - (r.ts || 0) < CUTOFF_MS);
  entries.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  entries = entries.slice(0, 500);
  try {
    fs.writeFileSync(
      logFile,
      entries.map((r) => JSON.stringify(r)).join("\n") + "\n"
    );
  } catch {}

  const currentRate = ctxTok / (activeMs / 60000); // tokens/min ativo, media desde o inicio — so pro ritmo vs historico de OUTRAS sessoes (onde media-desde-o-inicio e a comparacao correta e justa)

  // Ritmo vs media historica de outras sessoes — informativo, NAO decide o
  // fogo sozinho. Contexto 16% cheio com ritmo 3.9x historico chegava a
  // mostrar 4/5 fogos (bug reportado): ritmo rapido != urgencia de handoff
  // quando ainda sobra quase toda a janela. Fogo fica ancorado no %
  // contexto; ritmo so modula +-1 em cima disso.
  const baseline = entries.filter(
    (r) =>
      r.session_id !== sessionId &&
      r.tokens != null &&
      (r.active_ms || 0) >= 60000
  );
  let ratio = null;
  if (baseline.length >= 3) {
    const sumTokens = baseline.reduce((s, r) => s + r.tokens, 0);
    const sumActiveMin = baseline.reduce((s, r) => s + r.active_ms / 60000, 0);
    const baselineRate = sumActiveMin > 0 ? sumTokens / sumActiveMin : 0;
    if (baselineRate > 0) ratio = currentRate / baselineRate;
  }

  let fires =
    ctxPct >= 90 ? 5 : ctxPct >= 75 ? 4 : ctxPct >= 55 ? 3 : ctxPct >= 35 ? 2 : 1;
  if (ratio != null) {
    if (ratio >= 2.0) fires = Math.min(5, fires + 1);
    else if (ratio <= 0.5) fires = Math.max(1, fires - 1);
  }

  // Label = ETA de handoff no ritmo marginal (rateEma), sempre — o numero
  // acionavel que decide "quando fazer handoff", nunca um % ja repetido na
  // linha 1. Anota o ritmo vs historico so quando notavelmente rapido.
  const remaining = Math.max(0, ctxSize - ctxTok);
  let label =
    rateEma > 0
      ? `~${fmtDur((remaining / rateEma) * 60)} p/ handoff`
      : `handoff`;
  if (ratio != null && ratio >= 1.5) label += ` (${ratio.toFixed(1)}x ritmo)`;

  return `${pctColorSeq(fires * 20)}${"🔥".repeat(fires)} ${label}${RESET}`;
}

const segPace = burnPaceSeg();

const line2 = [segModelName, segCost, segDur, segPace]
  .filter(Boolean)
  .join(`  ${sep}  `);

// ---------- LINHA 3 ("Codex" · uso semanal) ----------

// Codex 7d (janela weekly) — do rollout mais recente, com cache 60s
function codexWeekly() {
  const cacheFile = path.join(HOME, ".claude", "statusline", ".codex7d.cache");
  try {
    const st = fs.statSync(cacheFile);
    if ((Date.now() - st.mtimeMs) / 1000 < 60) {
      return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    }
  } catch {}
  let result = { pct: null, resets_at: null, mtime: 0 };
  try {
    const base = path.join(HOME, ".codex", "sessions");
    // arquivo rollout mais recente por mtime
    const newest = sh(
      `find "${base}" -name 'rollout-*.jsonl' -type f -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1`
    );
    if (newest) {
      const mtime = fs.statSync(newest).mtimeMs;
      // ultima linha com rate_limits (procura no fim do arquivo)
      const line = sh(`tail -n 800 "${newest}" | grep '"rate_limits"' | tail -1`);
      if (line) {
        const obj = JSON.parse(line);
        const rl =
          obj?.payload?.rate_limits ||
          obj?.payload?.info?.rate_limits ||
          obj?.rate_limits;
        if (rl) {
          // pega a janela de maior duracao (weekly = 10080 min); fallback primary
          const cands = [rl.primary, rl.secondary].filter(
            (w) => w && w.used_percent != null
          );
          cands.sort(
            (a, b) => (b.window_minutes || 0) - (a.window_minutes || 0)
          );
          const w = cands[0];
          if (w) {
            result = {
              pct: w.used_percent,
              resets_at: w.resets_at || null,
              mtime,
            };
          }
        }
      }
    }
  } catch {}
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(result));
  } catch {}
  return result;
}

// Codex — palavra em azul fixo + separador + bloco explicativo
function codexSeg() {
  const cx = codexWeekly();
  const label = `${bold}${c(COL.codexLabel)}Codex${RESET}`;
  const rest = (() => {
    if (cx.pct == null) return `${dim}(uso semanal)${RESET} ${dim}sem dados${RESET}`;
    const ageH = cx.mtime ? (Date.now() - cx.mtime) / 3600000 : 999;
    const stale = ageH > 12;
    const p = cx.pct;
    let out = `${dim}(uso semanal)${RESET} ${bar(p, 7, white)} ${white}${Math.round(p)}%${RESET}`;
    if (stale) {
      out += ` ${dim}(dado desatualizado)${RESET}`;
    } else if (cx.resets_at) {
      const left = cx.resets_at - nowSec;
      if (left > 0) out += ` ${dim}reseta em ${fmtDur(left)}${RESET}`;
    }
    return out;
  })();
  return `${label}  ${sep}  ${rest}`;
}

// Linhas 3 e 4 (Codex + git) so fazem sentido dentro de um repo — fora de um
// checkout nao ha branch/worktree/files pra mostrar, e a linha do Codex vai
// junto (agrupadas como "contexto de repo").
let line3 = null;
let line4 = null;
let line5 = null;

if (inRepo) {
  line3 = codexSeg();

  // ---------- LINHA 4 (repo · branch · worktree · files) ----------
  const repoName = J?.workspace?.repo?.name;
  const segRepo = repoName
    ? `${c(COL.repo)}${repoName}${RESET}`
    : `${dim}repo?${RESET}`;

  // Branch
  const branch =
    sh("git rev-parse --abbrev-ref HEAD", cwd) ||
    sh("git symbolic-ref --short HEAD", cwd) ||
    "?";
  const segBranch = `${c(COL.branch)}⎇ ${branch}${RESET}`;

  // Worktree ativo
  let wtName = "(principal)";
  const m = cwd.match(/\.claude\/worktrees\/([^/]+)/);
  if (m) wtName = m[1];
  else {
    // se for um linked worktree fora do padrao, mostra basename do toplevel
    const top = sh("git rev-parse --show-toplevel", cwd);
    const gitDir = sh("git rev-parse --git-dir", cwd);
    if (top && gitDir.includes("/worktrees/")) wtName = path.basename(top);
  }
  const segWt = `${c(COL.worktree)}⌂ ${wtName}${RESET}`;

  // Files do checkout (modificados/untracked)
  const porcelain = sh("git status --porcelain", cwd);
  const nFiles = porcelain ? porcelain.split("\n").filter(Boolean).length : 0;
  const filesColor = nFiles === 0 ? 245 : COL.files;
  const segFiles = `${c(filesColor)}✎ ${nFiles} ${nFiles === 1 ? "file" : "files"}${RESET}`;

  line4 = [segRepo, segBranch, segWt, segFiles].join(`  ${sep}  `);

  // ---------- LINHA 5 (porta do npm run dev deste checkout, se houver) ----------
  const top = sh("git rev-parse --show-toplevel", cwd);
  const port = devPortSeg(cwd, top);
  if (port) {
    line5 = `${dim}dev server${RESET}  ${c(COL.port)}⚡ :${port}${RESET}`;
  }
}

// ---------- output ----------
const R = rule();
const lines = [line1, line2];
if (inRepo) lines.push(line3, line4, line5);
process.stdout.write(
  lines
    .filter(Boolean)
    .map((l) => l + "\n" + R)
    .join("\n")
);
