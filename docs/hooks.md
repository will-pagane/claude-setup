# Hooks

Hook é um comando que o **Claude Code** executa por conta própria em torno de um evento — antes de uma tool, ao abrir sessão, ao parar. Não é o Claude que decide rodar: é o harness. Por isso hook é a única forma de garantir um comportamento automático ("toda vez que X, faça Y") — instrução em CLAUDE.md pede, hook obriga.

Este setup usa **dois**, e nenhum dos dois é obrigatório para o resto funcionar.

| Hook | Evento | O que faz | Obrigatório? |
|---|---|---|---|
| RTK | `PreToolUse` / `Bash` | Reescreve o comando pra passar pelo `rtk`, que corta até 90% da saída antes dela voltar pro contexto | Não — mas sem ele o `RTK.md` no CLAUDE.md fica descrevendo algo que não acontece |
| reap-orphans | `SessionStart` | Só Windows. Mata árvore de processo órfã de test runner que sobreviveu ao fim da sessão | Não — resolve um problema que só existe no Windows |

## RTK — `PreToolUse` em `Bash`

```json
"hooks": {
  "PreToolUse": [
    { "matcher": "Bash", "hooks": [{ "type": "command", "command": "rtk hook claude" }] }
  ]
}
```

**Não escreva esse bloco à mão.** Instale o binário e rode:

```bash
rtk init --global
```

O próprio `rtk` escreve o hook no `settings.json` e mantém o formato quando muda de versão. Colar à mão é como o bloco fica desatualizado sem ninguém perceber.

**O que acontece se o hook existir e o `rtk` não:** o hook dispara em *todo* comando Bash e falha, porque o binário não está no PATH. O Claude Code não bloqueia a tool por causa disso — o comando roda — mas você ganha ruído de erro em cada chamada. Se for testar o setup sem instalar o RTK, **remova o bloco `PreToolUse`** em vez de conviver com o erro.

**Pré-requisito do próprio RTK:** `ripgrep` (`rg`) no PATH, senão ele avisa `Binary 'rg' not found`.

Instalação por sistema:

| Sistema | Comando |
|---|---|
| macOS / Linux | `brew install rtk-ai/tap/rtk` |
| macOS / Linux (sem brew) | `curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh \| sh` |
| Windows | baixe `rtk-x86_64-pc-windows-msvc.zip` em [releases](https://github.com/rtk-ai/rtk/releases), extraia `rtk.exe` num diretório do PATH (ex.: `~/.local/bin`) |

Depois, em qualquer sistema: `rtk init --global`.

## reap-orphans — `SessionStart`, só Windows

Windows não tem kill de process group POSIX. Quando você cancela uma tool call ou a sessão morre, o Claude Code mata só o shell imediato — `npm` → `cmd.exe` → `vitest` → pool de workers continua rodando, reparenteado, para sempre. Uma execução de vitest sobreviveu 5 dias assim, respawnando o pool de jsdom em loop.

O script está em [`hooks/reap-orphans.ps1`](../hooks/reap-orphans.ps1) e o `install.sh` o instala em `~/.claude/scripts/reap-orphans.ps1`. **O hook não é registrado automaticamente** — um hook que mata processo se liga por decisão sua.

Antes de ligar, rode em modo seco e leia o que ele mataria:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\.claude\scripts\reap-orphans.ps1" -WhatIf
```

Só depois adicione ao `settings.json` (trocando o caminho pelo seu):

```json
"SessionStart": [
  { "hooks": [{
      "type": "command",
      "command": "powershell",
      "args": ["-NoProfile","-ExecutionPolicy","Bypass","-File","C:\\Users\\SEU-USUARIO\\.claude\\scripts\\reap-orphans.ps1"],
      "async": true,
      "timeout": 30,
      "statusMessage": "Limpando processos orfaos..."
  }]}
]
```

**As três condições que ele exige antes de matar qualquer coisa** (todas, não uma):

1. a linha de comando bate um test runner/linter conhecido (`vitest|jest|mocha|playwright|eslint|tsc|npm-cli.js|nyc|karma`);
2. o **processo pai já morreu** — pai vivo significa trabalho de alguém acontecendo agora;
3. o processo tem mais de `-MinAgeMinutes` (padrão 10).

E há uma lista de proteção que casa por **identidade** (caminho de instalação, executável) — nunca por pedaço de caminho de projeto. O motivo está no comentário do script e vale repetir aqui: se os seus checkouts vivem sob `...\OneDrive\...\Projects\` e worktrees sob `<repo>\.claude\worktrees\`, proteger por `"OneDrive"` ou `"claude"` blindaria justamente todos os alvos reais.

`async: true` é o que impede o hook de segurar a abertura da sessão.

## Verificar o que está ligado

```bash
claude plugin list          # plugins (superpowers, caveman)
cat ~/.claude/settings.json # hooks, statusLine
rtk --version               # rtk instalado?
```

Dentro do Claude Code, `/hooks` mostra os hooks ativos da sessão — inclusive os que vieram de plugin, que não aparecem no seu `settings.json`.

## Escrevendo o seu

Um hook roda com o diretório do projeto como cwd e recebe o contexto do evento em JSON pelo stdin. As regras que evitam a maior parte da dor:

- **`async: true`** em qualquer hook que demore, senão ele entra no caminho crítico da sessão.
- **`timeout`** sempre — hook pendurado trava a tool.
- **Exit code importa em `PreToolUse`**: `2` **bloqueia** a tool e devolve o stderr pro Claude como motivo. Qualquer outro código não bloqueia. Saia com `0` no caminho feliz e trate `2` como decisão consciente.
- **Caminho absoluto** para o script. O PATH de um hook não é o do seu terminal.
- Teste o comando isolado no terminal antes de registrar. Hook quebrado falha em cada tool call, não uma vez.
