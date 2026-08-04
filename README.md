# claude-setup

Minha configuração pessoal do [Claude Code](https://claude.com/claude-code) — CLAUDE.md global, statusline custom, e a stack de plugins/skills que uso todo dia.

## O que tem aqui

| Arquivo | O que é |
|---|---|
| `CLAUDE.md` | Regras globais, aplicadas em todo projeto (`~/.claude/CLAUDE.md`) |
| `RTK.md` | Doc do [RTK](#rtk---rust-token-killer), importado pelo CLAUDE.md via `@RTK.md` |
| `statusline/statusline.mjs` | Script Node do statusline (ver abaixo) |
| `settings.example.json` | Trecho representativo do `~/.claude/settings.json` — hooks, plugins, prefs |

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
- Linha do **Codex** lida o `rate_limits` direto do rollout `.jsonl` mais recente em `~/.codex/sessions/`, cacheado 60s.
- **Custo em BRL** ao lado do USD nativo — cotação via [open.er-api.com](https://www.exchangerate-api.com/docs/free) (sem chave), cache de 12h em disco, fallback fixo se offline.
- Linhas de Codex e git **só aparecem dentro de um repo** (`git rev-parse --is-inside-work-tree`) — fora de um checkout, mostra só Claude + modelo/custo/duração.

Instalar: copie `statusline/statusline.mjs` pra `~/.claude/statusline/` e aponte `statusLine.command` no `settings.json` (ver `settings.example.json`).

## RTK - Rust Token Killer

CLI que filtra saída de `git`/`bash` antes de voltar pro contexto do Claude — corta até 90% do texto ruidoso (logs de git, output verboso de build). Um hook `PreToolUse` reescreve todo `Bash` transparente pra passar por ele. Ver `RTK.md`.

## Skills que uso (não vendorizadas aqui)

Skills instaladas via marketplace/pacote, cada uma no seu próprio repo — listo pra quem quiser instalar as mesmas, não copio o conteúdo (licença de terceiro, e ficaria desatualizado):

| Skill | Pra quê | Fonte |
|---|---|---|
| `superpowers` | Brainstorming, TDD, debugging sistemático, code review — o processo por trás de toda tarefa | plugin oficial `claude-plugins-official` |
| `caveman` | Modo de resposta ultra-comprimido (~75% menos token), mantendo precisão técnica | [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) |
| `impeccable` | Design/crítica de UI, sistema de design | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) |
| `grill-me-codex` | Entrevista adversarial sobre um plano, depois OpenAI Codex revisa em sandbox read-only | adaptado de [mattpocock/skills](https://github.com/mattpocock/skills) (MIT) |
| `codex-review` | Loop Claude↔Codex revisando um plano antes de escrever código | — |
| `graphify` | Grafo de conhecimento do código (rotas→arquivos→hooks→RPCs), consultável em vez de grep às cegas | — |
| `composio-cli` | Operar o Composio CLI (tools, triggers, workflows) | — |

## O que ainda quero adicionar

- `install.sh` — symlink de `CLAUDE.md`/`statusline.mjs` pra `~/.claude/` numa máquina nova
- GIF do statusline em ação
- Seção sobre o modo caveman (por quê, quando vale, quando desliga)
