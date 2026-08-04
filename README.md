# claude-setup

Minha configuração pessoal do [Claude Code](https://claude.com/claude-code) — CLAUDE.md global, statusline custom, skills próprias, e a stack de plugins de terceiro que uso todo dia.

## O que tem aqui

| Caminho | O que é |
|---|---|
| `CLAUDE.md` | Regras globais, aplicadas em todo projeto (`~/.claude/CLAUDE.md`) |
| `RTK.md` | Doc do [RTK](#rtk---rust-token-killer), importado pelo CLAUDE.md via `@RTK.md` |
| `statusline/statusline.mjs` | Script Node do statusline (ver abaixo) |
| `settings.example.json` | Trecho representativo do `~/.claude/settings.json` — hooks, plugins, prefs |
| `skills/` | Minhas skills próprias — ver [seção abaixo](#skills-próprias) |
| `install.sh` | Symlinka tudo isso pro `~/.claude` de uma máquina nova |

## install.sh

Em vez de copiar arquivo por arquivo numa máquina nova, `./install.sh` symlinka `CLAUDE.md`, `RTK.md`, `statusline/statusline.mjs` e cada pasta em `skills/` pra dentro do `~/.claude` real. Symlink em vez de cópia porque um `git pull` neste repo já atualiza tudo instalado, sem reinstalar nada. Não sobrescreve arquivo real que já exista (só symlink solto), e não mexe em plugins de terceiro (RTK, superpowers, caveman, impeccable) — esses têm instalação própria, ver seções abaixo.

```bash
git clone https://github.com/will-pagane/claude-setup.git
cd claude-setup
./install.sh              # tudo
./install.sh --skills     # só as skills, pula CLAUDE.md/statusline
```

## Filosofia (do CLAUDE.md)

Os pontos que mais mudam como trabalho com o Claude:

- **Thought partner, não gerador de código** — questiona requisito fraco, aponta lacuna (form sem validação? API sem auth?) antes de escrever.
- **Nunca commit/PR/merge sem pedido explícito** — estado terminal de uma sessão é "branch pushed, trabalho descrito", não um PR aberto.
- **CLI oficial > MCP** para Supabase e GitHub — motivo real: as write tools do MCP do Supabase carimbam a própria versão de ledger de migration, o que desincroniza o repo do banco.
- **Branch/worktree nomeados por sessão + timestamp** (`<tipo>/<slug>-<AAAAMMDD>`) — nunca aceitar nome aleatório gerado por ferramenta (tipo `claude/magical-jones-8c99`), pra sessões concorrentes ficarem legíveis.
- **Decisão pendente é prosa com trade-off**, nunca um menu A/B/C/D.

## Statusline

Statusline em 4 linhas (Node puro, zero dependência):

```
Claude │ context ████░░░░ 42% 420k/1M │ 5h ███░░░░ 29% ↺2h │ 7d ███░░░░ 30% ↺5d
────────────────────────────────────────────────────
◆ Opus 4.8 │ custo $2.91 │ brl R$14.76 │ duracao 7m
────────────────────────────────────────────────────
Codex │ (uso semanal) ░░░░░░░ 3% reseta em 6d23h
────────────────────────────────────────────────────
meu-repo │ ⎇ main │ ⌂ (principal) │ ✎ 2 files
```

- Barra de contexto/5h/7d com **gradiente verde→amarelo→vermelho** em degraus de 10% (truecolor).
- Linha do **Codex** lê o `rate_limits` direto do rollout `.jsonl` mais recente em `~/.codex/sessions/`, cacheado 60s.
- **Custo em BRL** ao lado do USD nativo — cotação via [open.er-api.com](https://www.exchangerate-api.com/docs/free) (sem chave), cache de 12h em disco, fallback fixo se offline.
- Linhas de Codex e git **só aparecem dentro de um repo** (`git rev-parse --is-inside-work-tree`) — fora de um checkout, mostra só Claude + modelo/custo/duração.

## RTK - Rust Token Killer

CLI que filtra saída de `git`/`bash` antes de voltar pro contexto do Claude — corta até 90% do texto ruidoso (logs de git, output verboso de build). Um hook `PreToolUse` reescreve todo `Bash` transparente pra passar por ele. Ver `RTK.md`.

## Skills próprias

Autorais ou modificadas por mim o suficiente pra valer vendorizar aqui direto (não são um link pra repo alheio):

| Skill | Pra quê |
|---|---|
| `session-build` | Pega specs escritas numa sessão e leva até shipped: implementa, testa, abre PR |
| `session-handoff` | Gera um prompt único e autocontido pra continuar a sessão em outra janela/agente |
| `code-ultragraph-review` | Review de codebase inteiro via grafo de conhecimento (graphify) — modo `--autopilot` roda pipeline autônomo: lê sinais do Supabase, aplica fix, verifica, abre PR |
| `codex-review` | Loop adversarial Claude↔Codex revisando um plano de implementação antes de escrever código — modifiquei a versão original pro meu fluxo |

## Plugins e skills de terceiro que uso

Instalados via marketplace, cada um no seu próprio repo — listo pra quem quiser instalar as mesmas, não vendorizo (repo já mantém isso atualizado, e evita duplicar licença/atribuição de terceiro):

| Nome | Pra quê | Fonte | Instalar |
|---|---|---|---|
| `superpowers` | Brainstorming, TDD, debugging sistemático, code review — o processo por trás de toda tarefa | plugin oficial, [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | `/plugin marketplace add anthropics/claude-plugins-official` depois `/plugin install superpowers` |
| `caveman` | Modo de resposta ultra-comprimido (~75% menos token), mantendo precisão técnica | [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) | `/plugin marketplace add JuliusBrussee/caveman` depois `/plugin install caveman` |
| `impeccable` | Design/crítica de UI, sistema de design | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | `/plugin marketplace add pbakaus/impeccable` depois `/plugin install impeccable` |
| `graphify` | Transforma qualquer pasta (código, docs, PDF, imagem, vídeo) num grafo de conhecimento navegável — base do `code-ultragraph-review` acima | [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) | `uv tool install graphifyy` (ou `pipx install graphifyy`) depois `graphify install` |

## O que ainda quero adicionar

- GIF do statusline em ação
- Seção sobre o modo caveman (por quê, quando vale, quando desliga)
