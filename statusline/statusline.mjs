#!/usr/bin/env node
// Fenix statusline — custom multi-linha para Claude Code.
// Linha 1 (fixa): "Claude" (laranja) · Context(barra+tokens) · Sessao 5h · Sessao 7d
// Linha 2 (rodizio, troca a cada 10s por relogio de parede — nao depende de
//          quando o statusline e re-renderizado, so de que horas sao agora):
//   - Modelo/custo: modelo (laranja) · custo "$USD - R$BRL" · duracao (ativo/total)
//   - Codex: uso semanal (barra branca)
//   - Git: repo · branch · worktree · files do checkout
//   - Porta do dev server (npm run dev / vite) deste checkout — so entra no
//     rodizio quando ha um rodando
//   - Stats: tokens novos gastos (sessao + sub-agentes) · ritmo de burn
//     (fogo vs media historica)
//   - Gate build/lint/test: le Bash tool_use/tool_result da sessao+sub-agentes
//     (nao roda nada, so observa o que ja rodou) — so entra se houver
//     transcript E package.json no toplevel do repo
//   Codex/Git/Porta/Gate so entram no rodizio dentro de um repo git; Modelo/custo
//   e Stats entram sempre. Rodizio some so se nao sobrar nenhum candidato.
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
  tokens: 183, // lilas — total de tokens (sessao + sub-agentes)
  warn: 203, // vermelho — modelo sem entrada em MODEL_PRICING
  gateFresh: 150, // verde — build/lint/test passou dentro do threshold de 10min
  gateStale: 214, // amarelo — passou, mas faz mais de 10min
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

// ---------- Modelo · custo "$USD - R$BRL" · duracao ativo/total (candidato do rodizio da linha 2) ----------
const modelName = J?.model?.display_name || J?.model?.id || "?";
const segModelName = `${bold}${c(COL.claude)}◆ ${modelName}${RESET}`;

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

// Tokens "novos": soma de usage(assistant) no transcript da sessao + todo
// transcript de sub-agente (Task/Agent tool, workflows) rodado a partir dela
// — "sessoes filhas" vivem em <sessionDir>/<sessionId>/subagents/**, arquivos
// separados que o campo cost.total_cost_usd do stdin ja pode nao refletir
// (sessoes/jobs em background tem cobranca propria).
// SO input+output+cache_creation — NAO cache_read_input_tokens. cache_read e
// releitura do MESMO contexto ja pago, repetida a cada turno da sessao inteira;
// somar isso ao longo de uma sessao longa infla o total pra milhoes sem
// significar trabalho novo (sessao com contexto de 100k pode acumular 3-4M
// so de releituras de cache, custando centavos por ser ~10% do preco normal).
function sumUsageTokens(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return 0;
  }
  let total = 0;
  for (const line of raw.split("\n")) {
    if (!line || !line.includes('"usage"')) continue;
    try {
      const u = JSON.parse(line)?.message?.usage;
      if (u) {
        total +=
          (u.input_tokens || 0) +
          (u.output_tokens || 0) +
          (u.cache_creation_input_tokens || 0);
      }
    } catch {}
  }
  return total;
}

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

// Lista transcript da sessao + todo transcript de sub-agente rodado a
// partir dela — mesma "sessao filha" que tokenTotals()/costTotals() ja
// escaneiam, so que aqui pro dev-loop-gate. Duplica a logica de achar
// subDir em vez de refatorar tokenTotals/costTotals pra usar isto — risco
// desnecessario mexer em codigo que ja funciona so pra desduplicar linhas.
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

function tokenTotals() {
  const transcriptPath = J?.transcript_path;
  const sessionId = J?.session_id;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  const sessionTokens = sumUsageTokens(transcriptPath);
  const subDir = path.join(path.dirname(transcriptPath), sessionId, "subagents");
  const subFiles = listJsonlRecursive(subDir);
  let subagentTokens = 0;
  for (const f of subFiles) subagentTokens += sumUsageTokens(f);
  return { sessionTokens, subagentTokens, total: sessionTokens + subagentTokens };
}
const tt = tokenTotals();

// Preco por milhao de tokens (USD), por model id exato como aparece em
// message.model no transcript. Cache write/read sao multiplicador sobre o
// preco de input (5m=1.25x, 1h=2x, read=0.1x), ja calculado aqui.
// Sonnet 5 esta com preco promocional ate 2026-08-31 — depois disso trocar
// pra {input:3.00, output:15.00, cacheWrite5m:3.75, cacheWrite1h:6.00, cacheRead:0.30}.
const MODEL_PRICING = {
  "claude-fable-5":           { input: 10.00, output: 50.00, cacheWrite5m: 12.50, cacheWrite1h: 20.00, cacheRead: 1.00 },
  "claude-mythos-5":          { input: 10.00, output: 50.00, cacheWrite5m: 12.50, cacheWrite1h: 20.00, cacheRead: 1.00 },
  "claude-opus-5":            { input: 5.00,  output: 25.00, cacheWrite5m: 6.25,  cacheWrite1h: 10.00, cacheRead: 0.50 },
  // Variante [1m]: 1M de contexto e o padrao do Opus 5, sem premio de
  // long-context — mesmo preco do id sem sufixo.
  "claude-opus-5[1m]":        { input: 5.00,  output: 25.00, cacheWrite5m: 6.25,  cacheWrite1h: 10.00, cacheRead: 0.50 },
  "claude-opus-4-8":          { input: 5.00,  output: 25.00, cacheWrite5m: 6.25,  cacheWrite1h: 10.00, cacheRead: 0.50 },
  "claude-opus-4-7":          { input: 5.00,  output: 25.00, cacheWrite5m: 6.25,  cacheWrite1h: 10.00, cacheRead: 0.50 },
  "claude-opus-4-6":          { input: 5.00,  output: 25.00, cacheWrite5m: 6.25,  cacheWrite1h: 10.00, cacheRead: 0.50 },
  "claude-sonnet-5":          { input: 2.00,  output: 10.00, cacheWrite5m: 2.50,  cacheWrite1h: 4.00,  cacheRead: 0.20 }, // intro ate 2026-08-31
  "claude-sonnet-4-6":        { input: 3.00,  output: 15.00, cacheWrite5m: 3.75,  cacheWrite1h: 6.00,  cacheRead: 0.30 },
  "claude-haiku-4-5-20251001":{ input: 1.00,  output: 5.00,  cacheWrite5m: 1.25,  cacheWrite1h: 2.00,  cacheRead: 0.10 },
};

// Custo real: soma usage(assistant) precificado pelo MODELO DAQUELE turno
// especifico (nao um preco fixo pra sessao inteira) — sessao/subagente pode
// misturar Sonnet, Haiku, Opus, Fable no mesmo transcript. Mesma varredura
// session+subagentes do tokenTotals() acima, so que preca em vez de somar
// bruto. Modelo sem entrada em MODEL_PRICING e pulado (nao arrisca preco
// errado) — cai no fallback de cost.total_cost_usd mais abaixo se isso
// zerar o total.
function sumUsageCostUsd(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return 0;
  }
  let total = 0;
  for (const line of raw.split("\n")) {
    if (!line || !line.includes('"usage"')) continue;
    try {
      const msg = JSON.parse(line)?.message;
      const u = msg?.usage;
      const model = msg?.model;
      if (!u || !model) continue;
      const price = MODEL_PRICING[model];
      if (!price) continue;
      const cc = u.cache_creation;
      const write5m = cc ? cc.ephemeral_5m_input_tokens || 0 : u.cache_creation_input_tokens || 0;
      const write1h = cc ? cc.ephemeral_1h_input_tokens || 0 : 0;
      total +=
        ((u.input_tokens || 0) * price.input +
          (u.output_tokens || 0) * price.output +
          (u.cache_read_input_tokens || 0) * price.cacheRead +
          write5m * price.cacheWrite5m +
          write1h * price.cacheWrite1h) /
        1e6;
    } catch {}
  }
  return total;
}

function costTotals() {
  const transcriptPath = J?.transcript_path;
  const sessionId = J?.session_id;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  const sessionCost = sumUsageCostUsd(transcriptPath);
  const subDir = path.join(path.dirname(transcriptPath), sessionId, "subagents");
  const subFiles = listJsonlRecursive(subDir);
  let subagentCost = 0;
  for (const f of subFiles) subagentCost += sumUsageCostUsd(f);
  return { sessionCost, subagentCost, total: sessionCost + subagentCost };
}
const ct = costTotals();
// ct.total==0 pode ser sessao nova OU so modelos desconhecidos — cai pro
// numero do harness (so loop principal, mas sempre disponivel) em vez de
// mostrar $0.00 errado.
const costUsd = ct != null && ct.total > 0 ? ct.total : J?.cost?.total_cost_usd ?? null;

// Modelo atual (o desta sessao/turno, nao dos sub-agentes) sem entrada em
// MODEL_PRICING — o total acima ja pula turnos assim (sem arriscar preco
// errado), mas isso pode SUBESTIMAR o custo mostrado sem nenhum aviso. Avisa
// explicito em vez de deixar o numero parecer completo quando nao e.
const currentModelId = J?.model?.id;
const modelUnpriced = currentModelId != null && !MODEL_PRICING[currentModelId];

const segCost = (() => {
  if (costUsd == null) return `${dim}custo${RESET} ${dim}—${RESET}`;
  const { rate, stale } = usdToBrlRate();
  const brl = (costUsd * rate).toFixed(2);
  let out =
    `${dim}custo${RESET} ${c(COL.cost)}$${costUsd.toFixed(2)}${RESET}` +
    `${dim} - ${RESET}` +
    `${c(COL.costBrl)}R$${brl}${RESET}${stale ? ` ${dim}~${RESET}` : ""}`;
  if (modelUnpriced) {
    out += ` ${c(COL.warn)}⚠ ${currentModelId} sem preco, custo pode estar subestimado${RESET}`;
  }
  return out;
})();

// Ritmo de burn: CUSTO, nao contexto. Mede tokens novos gastos por minuto
// ativo (sessao + sub-agentes — os tokens que contam pro limite de 7 dias,
// via tt.total ja somado acima) contra a media historica de OUTRAS sessoes.
// So fogo se sessao esta cara comparada ao seu proprio historico; sessao
// normal fica em 0-1 fogo, so escala com sessao genuinamente mais cara que
// o costume. Log em arquivo proprio (v2 — schema trocou de "tokens de
// contexto" pra "tokens novos gastos", nao dava pra reaproveitar o log
// antigo sem contaminar a baseline com escalas diferentes).
// Precisa de >=30s ativo na sessao atual E >=3 sessoes historicas de
// >=1min ativo pra qualquer leitura fazer sentido — sem baseline, esconde
// o segmento (sem sinal ainda) em vez de arriscar leitura errada.
function burnPaceSeg(tt) {
  const sessionId = J?.session_id;
  if (!sessionId || activeMs == null || activeMs < 30000) return null;
  if (!tt || tt.total <= 0) return null;

  const logFile = path.join(HOME, ".claude", "statusline", ".burn-log-v2.jsonl");
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
  // suavizacao EMA — pro label mostrar o ritmo RECENTE, nao a media desde o
  // inicio da sessao (que dilui um pico ou uma pausa longa de historico).
  const prevRec = map.get(sessionId) || null;
  const MIN_DELTA_ACTIVE_MS = 20000; // exige >=20s ativo novo pra amostrar de novo
  let rateEma = prevRec?.rate_ema ?? null;
  if (prevRec) {
    const deltaTokens = tt.total - (prevRec.tokens ?? tt.total);
    const deltaActiveMs = activeMs - (prevRec.active_ms ?? activeMs);
    // deltaTokens < 0 nao deveria acontecer (tokens gastos so crescem), mas
    // pula a amostra em vez de deixar virar "ritmo negativo" por seguranca.
    if (deltaTokens >= 0 && deltaActiveMs >= MIN_DELTA_ACTIVE_MS) {
      const instRate = deltaTokens / (deltaActiveMs / 60000);
      rateEma = rateEma == null ? instRate : 0.3 * instRate + 0.7 * rateEma;
    }
  }
  if (rateEma == null) {
    // primeiro render da sessao, sem delta ainda pra medir — usa a media
    // acumulada soh como semente inicial; a partir do proximo render o EMA
    // marginal assume e corrige o vies.
    rateEma = activeMs > 0 ? tt.total / (activeMs / 60000) : 0;
  }

  map.set(sessionId, {
    session_id: sessionId,
    tokens: tt.total,
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

  // Media desde o inicio (nao o EMA marginal) pra comparar com a baseline —
  // baseline de outras sessoes tambem e media-desde-o-inicio delas, entao
  // e a comparacao justa (maca com maca).
  const currentRate = tt.total / (activeMs / 60000);

  const baseline = entries.filter(
    (r) =>
      r.session_id !== sessionId &&
      r.tokens != null &&
      (r.active_ms || 0) >= 60000
  );
  if (baseline.length < 3) return null; // sem baseline confiavel, sem sinal pra mostrar

  const sumTokens = baseline.reduce((s, r) => s + r.tokens, 0);
  const sumActiveMin = baseline.reduce((s, r) => s + r.active_ms / 60000, 0);
  const baselineRate = sumActiveMin > 0 ? sumTokens / sumActiveMin : 0;
  if (baselineRate <= 0) return null;
  const ratio = currentRate / baselineRate;

  // Degraus deliberadamente enviesados pra baixo: sessao no ritmo normal
  // (perto de 1x a propria media historica) fica em 0-1 fogo. So sessao
  // genuinamente mais cara que o costume sobe fogo.
  const fires =
    ratio < 0.6 ? 0 : ratio < 1.1 ? 1 : ratio < 1.8 ? 2 : ratio < 2.8 ? 3 : ratio < 4.5 ? 4 : 5;

  const label = `${ratio.toFixed(1)}x ritmo · ${fmtTokens(rateEma)} tok/min`;
  const icon = fires === 0 ? "❄" : "🔥".repeat(fires);
  const color = fires === 0 ? c(COL.h5) : pctColorSeq(fires * 20);
  return `${color}${icon} ${label}${RESET}`;
}

const segPace = burnPaceSeg(tt);

// Modelo/custo/duracao — um dos candidatos do rodizio da linha 2 (nao mais
// linha fixa).
const segModelCostDur = [segModelName, segCost, segDur]
  .filter(Boolean)
  .join(`  ${sep}  `);

// Stats (tokens novos + ritmo de burn) — outro candidato do rodizio.
function statsSeg() {
  const parts = [];
  if (tt && tt.total > 0) {
    parts.push(
      `${c(COL.tokens)}tokens ${fmtTokens(tt.total)}${RESET}` +
        (tt.subagentTokens > 0
          ? ` ${dim}(${fmtTokens(tt.sessionTokens)} + ${fmtTokens(
              tt.subagentTokens
            )} sub-agentes)${RESET}`
          : "")
    );
  }
  if (segPace) parts.push(segPace);
  return parts.length ? parts.join(`  ${sep}  `) : null;
}
const segStats = statsSeg();

// ---------- CANDIDATOS DO RODIZIO ("Codex" · uso semanal) ----------

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

// Codex/Git/Porta so fazem sentido dentro de um repo — fora de um checkout
// nao ha branch/worktree/files/dev-server pra mostrar. Modelo/custo e Stats
// entram sempre.
const rotateCandidates = [segModelCostDur];

if (inRepo) {
  rotateCandidates.push(codexSeg());

  // ---------- Git (repo · branch · worktree · files) ----------
  const repoName = J?.workspace?.repo?.name;
  const segRepo = repoName
    ? `${c(COL.repo)}${repoName}${RESET}`
    : `${dim}repo?${RESET}`;

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

  rotateCandidates.push(
    [segRepo, segBranch, segWt, segFiles].join(`  ${sep}  `)
  );

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

if (segStats) rotateCandidates.push(segStats);

// Rodizio por relogio de parede — nao por contagem de render. Cada 10s reais
// (ROTATE_MS) avanca pro proximo candidato disponivel nesse momento; troca de
// tamanho do array entre renders (ex.: dev server subiu/caiu) so muda o
// mapeamento indice->candidato dali pra frente, sem quebrar nada. So avanca
// quando o statusline e re-renderizado pelo harness — sem re-render (ex.:
// sessao ociosa esperando o usuario), o valor exibido fica parado ate o
// proximo render, mesmo o indice calculado ja tendo mudado por baixo.
const ROTATE_MS = 10000;
let line2 = null;
if (rotateCandidates.length === 1) {
  line2 = rotateCandidates[0];
} else if (rotateCandidates.length > 1) {
  const rotIdx = Math.floor(Date.now() / ROTATE_MS) % rotateCandidates.length;
  line2 = `${rotateCandidates[rotIdx]}  ${dim}(${rotIdx + 1}/${rotateCandidates.length})${RESET}`;
}

// ---------- output ----------
const R = rule();
const lines = [line1, line2];
process.stdout.write(
  lines
    .filter(Boolean)
    .map((l) => l + "\n" + R)
    .join("\n")
);
