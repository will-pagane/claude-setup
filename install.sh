#!/bin/bash
# install.sh — instala esta config no ~/.claude de uma maquina nova.
# Symlinka em vez de copiar: puxar de novo (git pull) atualiza tudo automatico.
#
# Uso:
#   ./install.sh              # symlink de tudo
#   ./install.sh --skills     # symlink so das skills, pula CLAUDE.md/statusline

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SKILLS_ONLY=false
[ "${1:-}" = "--skills" ] && SKILLS_ONLY=true

link() {
  local src="$1" dst="$2"
  if [ -e "$dst" ] && [ ! -L "$dst" ]; then
    echo "SKIP  $dst (arquivo real ja existe, nao sobrescrevo — mova/apague e rode de novo se quiser o symlink)"
    return
  fi
  mkdir -p "$(dirname "$dst")"
  ln -sfn "$src" "$dst"
  echo "LINK  $dst -> $src"
}

if [ "$SKILLS_ONLY" = false ]; then
  link "$REPO_DIR/CLAUDE.md" "$CLAUDE_DIR/CLAUDE.md"
  link "$REPO_DIR/RTK.md" "$CLAUDE_DIR/RTK.md"
  link "$REPO_DIR/statusline/statusline.mjs" "$CLAUDE_DIR/statusline/statusline.mjs"
  echo
  echo "Lembrete: aponte statusLine.command no settings.json pra"
  echo "  node \"$CLAUDE_DIR/statusline/statusline.mjs\""
  echo "(ver settings.example.json neste repo)"
  echo
fi

for d in "$REPO_DIR"/skills/*/; do
  name="$(basename "$d")"
  link "$d" "$CLAUDE_DIR/skills/$name"
done

echo
echo "RTK, superpowers, caveman e impeccable NAO sao instalados por este script —"
echo "sao ferramentas/plugins de terceiro, ver README.md pra instrucao de cada um."
