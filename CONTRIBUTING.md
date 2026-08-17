# Contribuindo

Isso é minha config pessoal de Claude Code, publicada pra quem quiser copiar ideias ou pedaços — não é um framework mantido pra uso geral.

**Aceito PR de:**
- Bug real no `statusline.mjs`, no `install.sh` ou nos hooks (quebra, edge case, crash)
- Quebra de portabilidade — algo que funciona no meu macOS/Windows e não no seu sistema
- Typo ou informação desatualizada no README/CLAUDE.md/docs
- Link morto ou comando de instalação errado

**Provavelmente não vou aceitar:**
- Feature nova no statusline pra caso de uso que não é o meu
- Mudança de estilo/preferência pessoal (cor, formato, convenção de nome)
- Skills novas — as que estão em `skills/` são as que uso, não uma coleção curada pra terceiros

## Antes de abrir o PR

O CI roda sozinho, mas rodar antes economiza uma rodada:

```bash
bash -n install.sh
node --check statusline/statusline.mjs
node -e "JSON.parse(require('fs').readFileSync('settings.example.json','utf8'))"

# smoke test do instalador num HOME descartável — nunca no seu ~/.claude
CLAUDE_CONFIG_DIR=$(mktemp -d) ./install.sh --dry-run
CLAUDE_CONFIG_DIR=$(mktemp -d) ./install.sh
```

Mexeu no `install.sh`? O job `install-smoke` do CI cobre dry-run, reinstalação, `--force`, `--settings` e `--uninstall`. Um comportamento novo entra com o teste dele junto — o bug que motivou esse job era um instalador que rodava limpo e deixava o `~/.claude` pela metade.

Se quiser algo diferente, fork é o caminho mais rápido — o repo inteiro é MIT.
