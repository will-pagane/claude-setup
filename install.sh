#!/usr/bin/env bash
# install.sh — instala esta config no ~/.claude de uma maquina nova.
#
# Symlinka quando o sistema permite: um `git pull` neste repo passa a atualizar
# tudo que ja esta instalado, sem reinstalar nada. Quando o sistema NAO permite
# symlink (Windows sem Developer Mode, que e o caso comum), copia — e diz que
# copiou, porque copia nao se atualiza sozinha e fingir o contrario e pior do
# que a copia.
#
# Uso:
#   ./install.sh                  # CLAUDE.md + RTK.md + statusline + skills
#   ./install.sh --skills         # so as skills
#   ./install.sh --third-party    # so os plugins/CLIs de terceiro
#   ./install.sh --all            # tudo acima, na ordem
#   ./install.sh --uninstall      # remove o que este script instalou
#
# Flags:
#   --copy        forca copia mesmo onde symlink funcionaria
#   --force       substitui arquivo real que ja exista (guarda .bak antes)
#   --dry-run     mostra o que faria, nao escreve nada
#   --settings    aplica statusLine + hook do RTK no settings.json (faz backup)
#   -h, --help    esta ajuda

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

DO_CORE=true
DO_SKILLS=true
DO_THIRD_PARTY=false
DO_SETTINGS=false
DO_UNINSTALL=false
FORCE_COPY=false
FORCE=false
DRY_RUN=false

RED=$'\033[31m'; YLW=$'\033[33m'; GRN=$'\033[32m'; DIM=$'\033[2m'; RST=$'\033[0m'
# Sem TTY (CI, pipe), cor vira ruido no log.
[ -t 1 ] || { RED=""; YLW=""; GRN=""; DIM=""; RST=""; }

warns=0
warn() { printf '%s\n' "${YLW}AVISO${RST}  $*" >&2; warns=$((warns + 1)); }
die()  { printf '%s\n' "${RED}ERRO${RST}   $*" >&2; exit 1; }
info() { printf '%s\n' "$*"; }

usage() { sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --skills)      DO_CORE=false; DO_SKILLS=true ;;
    --third-party) DO_CORE=false; DO_SKILLS=false; DO_THIRD_PARTY=true ;;
    --all)         DO_CORE=true;  DO_SKILLS=true; DO_THIRD_PARTY=true ;;
    --uninstall)   DO_UNINSTALL=true ;;
    --settings)    DO_SETTINGS=true ;;
    --copy)        FORCE_COPY=true ;;
    --force)       FORCE=true ;;
    --dry-run)     DRY_RUN=true ;;
    -h|--help)     usage; exit 0 ;;
    # Argumento desconhecido para o script em vez de ser ignorado em silencio:
    # um `--skils` digitado errado instalava tudo sem avisar.
    *)             printf '%s\n' "${RED}ERRO${RST}   argumento desconhecido: $1" >&2; echo; usage; exit 2 ;;
  esac
  shift
done

# ---------------------------------------------------------------- capacidades

# Symlink e capacidade do SISTEMA, nao do SO: Windows com Developer Mode ligado
# symlinka, Windows sem ele nao. `ln -s` do Git Bash e pior que falhar — ele
# COPIA e retorna 0, entao a unica leitura confiavel e escrever um symlink de
# teste e perguntar ao `test -L` se o que ficou no disco e mesmo um symlink.
can_symlink() {
  local probe_dir probe_src probe_dst rc
  probe_dir="$(mktemp -d 2>/dev/null)" || return 1
  probe_src="$probe_dir/src"; probe_dst="$probe_dir/dst"
  : > "$probe_src"
  rc=1
  if ln -s "$probe_src" "$probe_dst" 2>/dev/null && [ -L "$probe_dst" ]; then
    rc=0
  fi
  rm -rf "$probe_dir"
  return $rc
}

have() { command -v "$1" >/dev/null 2>&1; }

MODE="copy"
if [ "$FORCE_COPY" = false ] && can_symlink; then
  MODE="symlink"
fi

# ------------------------------------------------------------------ instalar

# Marca o que este script instalou, pra --uninstall nao ter que adivinhar
# (e nunca remover um arquivo que era do usuario).
MANIFEST="$CLAUDE_DIR/.claude-setup-manifest"

record() {
  [ "$DRY_RUN" = true ] && return 0
  mkdir -p "$(dirname "$MANIFEST")"
  grep -qxF "$1" "$MANIFEST" 2>/dev/null || printf '%s\n' "$1" >> "$MANIFEST"
}

# Instala $1 (no repo) em $2 (no ~/.claude), symlinkando ou copiando.
install_path() {
  local src="$1" dst="$2" label="${3:-}"

  if [ ! -e "$src" ]; then
    warn "origem nao existe, pulando: $src"
    return 0
  fi

  # Symlink nosso (aponta pra dentro deste repo) e substituivel sem cerimonia.
  # Arquivo real do usuario nao — sem --force ele fica, e o script diz por que.
  if [ -e "$dst" ] || [ -L "$dst" ]; then
    if [ -L "$dst" ]; then
      :
    elif [ "$FORCE" = true ]; then
      if [ "$DRY_RUN" = false ]; then
        rm -rf "$dst.bak"
        mv "$dst" "$dst.bak"
      fi
      info "${DIM}BAK   $dst -> $dst.bak${RST}"
    else
      # Copia instalada por uma rodada anterior deste mesmo script conta como
      # nossa: sem isso, `git pull && ./install.sh` no Windows virava no-op
      # silencioso a partir da segunda execucao.
      if grep -qxF "$dst" "$MANIFEST" 2>/dev/null; then
        :
      else
        info "${YLW}SKIP${RST}  $dst ${DIM}(arquivo seu, nao sobrescrevo — use --force pra substituir com backup)${RST}"
        return 0
      fi
    fi
  fi

  if [ "$DRY_RUN" = true ]; then
    info "${DIM}DRY   $MODE $dst${RST}"
    return 0
  fi

  mkdir -p "$(dirname "$dst")"
  rm -rf "$dst"

  if [ "$MODE" = "symlink" ]; then
    ln -sfn "$src" "$dst"
    # Verifica em vez de confiar: o `ln` do Git Bash retorna 0 depois de copiar.
    [ -L "$dst" ] || die "esperava symlink em $dst e o disco tem outra coisa — rode com --copy"
    info "${GRN}LINK${RST}  $dst ${DIM}-> $src${RST}"
  else
    cp -R "$src" "$dst"
    info "${GRN}COPY${RST}  $dst ${DIM}<- $src${RST}"
  fi
  record "$dst"
  [ -n "$label" ] && info "      ${DIM}$label${RST}"
  return 0
}

uninstall() {
  if [ ! -f "$MANIFEST" ]; then
    die "sem $MANIFEST — nada registrado por este script pra remover"
  fi
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if [ -e "$p" ] || [ -L "$p" ]; then
      if [ "$DRY_RUN" = true ]; then
        info "${DIM}DRY   rm $p${RST}"
      else
        rm -rf "$p"
        info "${GRN}RM${RST}    $p"
      fi
    fi
  done < "$MANIFEST"
  [ "$DRY_RUN" = false ] && rm -f "$MANIFEST"
  info
  info "Plugins de terceiro nao sao removidos por aqui: ${DIM}claude plugin uninstall <nome>${RST}"
}

# ------------------------------------------------------------------ terceiros

third_party() {
  info
  info "── Plugins e CLIs de terceiro ─────────────────────────────"

  if have claude; then
    # marketplace|repo|plugin — o id final e <plugin>@<marketplace>.
    for entry in \
      "claude-plugins-official|anthropics/claude-plugins-official|superpowers" \
      "caveman|JuliusBrussee/caveman|caveman" \
      "impeccable|pbakaus/impeccable|impeccable"
    do
      IFS='|' read -r market repo plugin <<< "$entry"
      if claude plugin list 2>/dev/null | grep -q "$plugin@"; then
        info "${GRN}OK${RST}    $plugin ja instalado"
        continue
      fi
      if [ "$DRY_RUN" = true ]; then
        info "${DIM}DRY   claude plugin install $plugin@$market${RST}"
        continue
      fi
      info "      instalando $plugin ${DIM}($repo)${RST}"
      claude plugin marketplace add "$repo" >/dev/null 2>&1 || true
      claude plugin install "$plugin@$market" --scope user --yes \
        || warn "falhou instalar $plugin — rode manualmente: claude plugin install $plugin@$market"
    done
  else
    warn "CLI 'claude' nao encontrado no PATH — instale os plugins de dentro do Claude Code:"
    info "        /plugin marketplace add anthropics/claude-plugins-official"
    info "        /plugin install superpowers"
    info "        /plugin marketplace add JuliusBrussee/caveman"
    info "        /plugin install caveman"
  fi

  # RTK e graphify sao binarios, nao plugins — instalar software de terceiro
  # sem o usuario mandar nao e papel deste script. Ele detecta e instrui.
  info
  if have rtk; then
    info "${GRN}OK${RST}    rtk ja instalado ${DIM}($(rtk --version 2>/dev/null | head -1))${RST}"
    info "      ${DIM}hook do Claude Code: rtk init --global${RST}"
  else
    info "${YLW}FALTA${RST} rtk ${DIM}(https://github.com/rtk-ai/rtk — Apache-2.0)${RST}"
    case "$(uname -s)" in
      Darwin|Linux)
        info "        brew install rtk-ai/tap/rtk"
        info "        ${DIM}ou:${RST} curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh"
        ;;
      *)
        info "        baixe rtk-x86_64-pc-windows-msvc.zip em https://github.com/rtk-ai/rtk/releases"
        info "        extraia rtk.exe para um diretorio no PATH (ex.: ~/.local/bin)"
        ;;
    esac
    info "        depois: ${DIM}rtk init --global${RST} (escreve o hook PreToolUse no settings.json)"
    have rg || info "        ${DIM}pre-requisito do rtk: ripgrep (rg) no PATH${RST}"
  fi

  if have graphify; then
    info "${GRN}OK${RST}    graphify ja instalado"
  else
    info "${YLW}FALTA${RST} graphify ${DIM}(https://github.com/Graphify-Labs/graphify — so o code-ultragraph-review depende dele)${RST}"
    info "        uv tool install graphifyy ${DIM}(ou pipx install graphifyy)${RST}, depois: graphify install"
  fi

  if have codex; then
    info "${GRN}OK${RST}    codex CLI ja instalado"
  else
    info "${YLW}FALTA${RST} codex CLI ${DIM}(https://github.com/openai/codex — codex-review e session-build dependem dele)${RST}"
    info "        npm i -g @openai/codex ${DIM}(ou brew install codex)${RST}, depois: codex login"
  fi
}

# ------------------------------------------------------------------ settings

apply_settings() {
  local settings="$CLAUDE_DIR/settings.json"
  local sl_cmd="node \"$CLAUDE_DIR/statusline/statusline.mjs\""

  if ! have node; then
    warn "node nao encontrado — pulei o patch do settings.json (o statusline precisa de node de qualquer forma)"
    return 0
  fi
  if [ "$DRY_RUN" = true ]; then
    info "${DIM}DRY   patch statusLine em $settings${RST}"
    return 0
  fi

  [ -f "$settings" ] && cp "$settings" "$settings.bak-$(date +%Y%m%d%H%M%S)"

  # Merge cirurgico via node: mexe so em statusLine e preserva o resto do JSON
  # do usuario (permissions, model, enabledPlugins) exatamente como estava.
  SETTINGS_PATH="$settings" STATUSLINE_CMD="$sl_cmd" node -e '
    const fs = require("fs");
    const p = process.env.SETTINGS_PATH;
    let j = {};
    if (fs.existsSync(p)) {
      try { j = JSON.parse(fs.readFileSync(p, "utf8")); }
      catch { console.error("settings.json existente nao e JSON valido — abortei o patch"); process.exit(1); }
    }
    j.statusLine = { type: "command", command: process.env.STATUSLINE_CMD, refreshInterval: 10 };
    fs.mkdirSync(require("path").dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  ' || { warn "patch do settings.json falhou — aplique o trecho de settings.example.json a mao"; return 0; }

  info "${GRN}SET${RST}   statusLine aplicado em $settings ${DIM}(backup .bak-*)${RST}"
  info "      ${DIM}o hook do RTK e instalado pelo proprio rtk: rtk init --global${RST}"
}

# ---------------------------------------------------------------------- main

info "repo:    $REPO_DIR"
info "destino: $CLAUDE_DIR"
info "modo:    $MODE$([ "$DRY_RUN" = true ] && echo " (dry-run)")"
info

if [ "$DO_UNINSTALL" = true ]; then
  uninstall
  exit 0
fi

# So avisa sobre symlink quando esta rodada realmente instala arquivo —
# `--third-party` sozinho nao escreve nada em ~/.claude.
if [ "$MODE" = "copy" ] && [ "$FORCE_COPY" = false ] \
   && { [ "$DO_CORE" = true ] || [ "$DO_SKILLS" = true ]; }; then
  warn "este sistema nao cria symlink (Windows sem Developer Mode?) — instalando por COPIA."
  info "      ${DIM}Copia nao se atualiza sozinha: depois de um 'git pull' aqui, rode ./install.sh de novo.${RST}"
  info "      ${DIM}Pra ganhar symlink no Windows: Configuracoes > Sistema > Para desenvolvedores > Modo de desenvolvedor.${RST}"
  info
fi

if [ "$DO_CORE" = true ]; then
  have node || warn "node nao encontrado no PATH — o statusline nao vai rodar sem ele (https://nodejs.org)"
  install_path "$REPO_DIR/CLAUDE.md" "$CLAUDE_DIR/CLAUDE.md"
  install_path "$REPO_DIR/RTK.md" "$CLAUDE_DIR/RTK.md"
  install_path "$REPO_DIR/statusline/statusline.mjs" "$CLAUDE_DIR/statusline/statusline.mjs"
  # Instala o script do hook, mas nao registra o hook: um hook que mata
  # processo se liga por decisao do usuario, no settings.json (ver docs/hooks.md).
  install_path "$REPO_DIR/hooks/reap-orphans.ps1" "$CLAUDE_DIR/scripts/reap-orphans.ps1"
fi

if [ "$DO_SKILLS" = true ]; then
  for d in "$REPO_DIR"/skills/*/; do
    [ -d "$d" ] || continue
    install_path "${d%/}" "$CLAUDE_DIR/skills/$(basename "$d")"
  done
fi

[ "$DO_SETTINGS" = true ] && apply_settings
[ "$DO_THIRD_PARTY" = true ] && third_party

info
if [ "$DO_SETTINGS" = false ] && [ "$DO_CORE" = true ]; then
  info "Falta ligar o statusline — rode ${DIM}./install.sh --settings${RST} ou ponha no $CLAUDE_DIR/settings.json:"
  info "  ${DIM}\"statusLine\": { \"type\": \"command\", \"command\": \"node \\\"\$HOME/.claude/statusline/statusline.mjs\\\"\", \"refreshInterval\": 10 }${RST}"
  info
fi
if [ "$DO_THIRD_PARTY" = false ]; then
  info "Superpowers, caveman, rtk, graphify e codex nao foram tocados — ${DIM}./install.sh --third-party${RST} detecta e instrui cada um."
  info
fi
if [ "$warns" -gt 0 ]; then
  info "${YLW}Terminou com $warns aviso(s) acima.${RST}"
else
  info "${GRN}Pronto.${RST} Reinicie o Claude Code pra carregar skills e statusline."
fi
