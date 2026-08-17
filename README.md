# claude-setup

Minha configuração pessoal do [Claude Code](https://claude.com/claude-code) — CLAUDE.md global, statusline custom, skills próprias, e a stack de plugins de terceiro que uso todo dia.

Publicado pra quem quiser copiar o todo ou pedaços. **Não é framework**: é a config de uma pessoa, com as opiniões dessa pessoa. A parte que quase todo mundo aproveita é o statusline e a cadeia `session-*`; a parte que quase ninguém deve copiar sem ler é o `CLAUDE.md`, que carrega regras específicas do meu fluxo (Supabase, convenção de branch, política de commit).

## Índice

- [Pré-requisitos](#pré-requisitos)
- [Instalação](#instalação)
- [O que tem aqui](#o-que-tem-aqui)
- [Filosofia (do CLAUDE.md)](#filosofia-do-claudemd)
- [Statusline](#statusline)
- [Skills próprias](#skills-próprias)
- [Hooks](#hooks)
- [Plugins e ferramentas de terceiro](#plugins-e-ferramentas-de-terceiro)
- [Conteúdos pra assistir](#conteúdos-pra-assistir)
- [O que sai da sua máquina](#o-que-sai-da-sua-máquina)

## Pré-requisitos

| Item | Pra quê | Sem ele |
|---|---|---|
| Claude Code **2.1.221+** | tudo | o statusline lê campos do stdin (`rate_limits`, `cost.total_duration_ms`) que são recentes; em versão antiga eles somem — o script mostra `—` em vez de quebrar |
| **Node 18+** no PATH | statusline | statusline não roda (é o único componente que precisa de Node) |
| **bash** | `install.sh` | no Windows vem com o [Git for Windows](https://git-scm.com/download/win) |
| `git` | clonar e atualizar | — |

Opcionais, cada um preso a uma skill específica — ver [dependências por skill](#skills-próprias).

### Windows: leia isto antes

`install.sh` prefere **symlink**, pra que um `git pull` neste repo atualize tudo que já está instalado. Windows só permite symlink com o **Modo de Desenvolvedor ligado** (`Configurações > Sistema > Para desenvolvedores`).

Sem ele, o script **copia e diz que copiou**. Copia funciona igual, com uma diferença que importa: ela não se atualiza sozinha, então depois de cada `git pull` aqui você roda `./install.sh` de novo.

> O `ln -s` do Git Bash não falha quando não consegue symlinkar — ele copia e retorna sucesso. Por isso o script escreve um symlink de teste e pergunta ao disco o que ficou lá, em vez de confiar no código de saída.

## Instalação

```bash
git clone https://github.com/will-pagane/claude-setup.git
cd claude-setup

./install.sh --dry-run     # mostra o que faria, não escreve nada
./install.sh               # CLAUDE.md + RTK.md + statusline + hooks + skills
./install.sh --settings    # liga o statusline no seu settings.json (com backup)
./install.sh --third-party # detecta e instala/instrui superpowers, caveman, impeccable, rtk, graphify, codex
```

Depois, **reinicie o Claude Code** — skills e statusline são carregados na abertura da sessão.

| Flag | Efeito |
|---|---|
| `--skills` | só as skills, pula CLAUDE.md/statusline |
| `--third-party` | só os plugins/CLIs de terceiro |
| `--all` | tudo, na ordem |
| `--settings` | escreve `statusLine` no `settings.json`, preservando o resto (backup `.bak-<timestamp>`) |
| `--copy` | força cópia mesmo onde symlink funcionaria |
| `--force` | substitui arquivo real seu que já exista, guardando `.bak` antes |
| `--dry-run` | mostra, não escreve |
| `--uninstall` | remove o que este script instalou — e só isso |

O script **não sobrescreve arquivo seu**. Se você já tem um `~/.claude/CLAUDE.md`, ele avisa e pula; `--force` substitui, guardando backup. O que ele instalou fica anotado em `~/.claude/.claude-setup-manifest`, e é essa lista que o `--uninstall` remove — nada fora dela.

Instalando em outro diretório: `CLAUDE_CONFIG_DIR=/caminho ./install.sh`.

## O que tem aqui

| Caminho | O que é |
|---|---|
| `CLAUDE.md` | Regras globais, aplicadas em todo projeto (`~/.claude/CLAUDE.md`) |
| `RTK.md` | Doc do [RTK](#plugins-e-ferramentas-de-terceiro), importado pelo CLAUDE.md via `@RTK.md` |
| `statusline/statusline.mjs` | Script Node do statusline |
| `settings.example.json` | Trecho comentado do `~/.claude/settings.json` — statusLine, hooks, plugins |
| `hooks/reap-orphans.ps1` | Hook opcional de Windows — mata processo órfão de test runner |
| `skills/` | Minhas skills próprias — ver [abaixo](#skills-próprias) |
| `docs/hooks.md` | Os dois hooks deste setup, e como escrever o seu |
| `docs/cadeia-session.md` | Como as três skills `session-*` se encaixam, com fluxogramas |
| `docs/conteudos.md` | Vídeos e cursos que mudaram alguma decisão deste setup, com o que pular em cada um |
| `install.sh` | Instala tudo isso no `~/.claude` |

## Filosofia (do CLAUDE.md)

Os pontos que mais mudam como trabalho com o Claude:

- **Thought partner, não gerador de código** — questiona requisito fraco, aponta lacuna (form sem validação? API sem auth?) antes de escrever.
- **Nunca commit/PR/merge sem pedido explícito** — estado terminal de uma sessão é "branch pushed, trabalho descrito", não um PR aberto.
- **CLI oficial > MCP** para Supabase e GitHub — motivo real: as write tools do MCP do Supabase carimbam a própria versão de ledger de migration, o que desincroniza o repo do banco.
- **Branch/worktree nomeados por sessão + timestamp** (`<tipo>/<slug>-<AAAAMMDD>`) — nunca aceitar nome aleatório gerado por ferramenta (tipo `claude/magical-jones-8c99`), pra sessões concorrentes ficarem legíveis.
- **Decisão pendente é prosa com trade-off**, nunca um menu A/B/C/D.

Se for adotar o `CLAUDE.md` inteiro, saiba que ele decide coisas por você: proíbe commit sem pedido, proíbe `--squash`, exige nome de branch com data, e assume Supabase CLI. Cada uma dessas regras existe por um incidente específico — mas o incidente foi meu, não necessariamente seu.

## Statusline

3 linhas (Node puro, zero dependência) — as duas primeiras fixas, a terceira em rodízio:

![Statusline em ação](docs/statusline.png)

```
Claude │ context ████░░░░ 42% 420k/1M │ 5h ███░░░░ 29% ↺2h │ 7d ███░░░░ 30% ↺5d
────────────────────────────────────────────────────
◆ Opus 4.8 │ custo $2.91 - R$14.76 │ ⏱ 7m ativo / 12m total
────────────────────────────────────────────────────
tokens 542k (480k + 62k sub-agentes) │ 🔥🔥🔥 1.8x ritmo · 50k tok/min │ (4/4)
────────────────────────────────────────────────────
```

- Barra de contexto/5h/7d com **gradiente verde→amarelo→vermelho** em degraus de 10% (truecolor).
- **Linha 3 é um rodízio**, não fixa: alterna entre até 4 candidatos — Codex (uso semanal), git (repo·branch·worktree·files), porta do dev server (só entra se houver um rodando) e o bloco de tokens/ritmo de burn. A troca é por relógio de parede (`Date.now()` dividido pelo intervalo), não por contador de render — por isso o `statusLine.refreshInterval` no `settings.json` **é obrigatório** pra rotação funcionar: sem ele, o script só re-roda em eventos (mensagem nova, `/compact`) e **trava sem trocar** durante um turno longo com vários tool calls seguidos. `settings.example.json` já inclui `"refreshInterval": 10`.
- **Tokens** conta só o que representa gasto real: `input + output + cache_creation`, **sem** `cache_read_input_tokens` — cache lido de novo a cada turno da sessão inteira incha o total pra milhões sem refletir trabalho novo (é ~10% do preço normal). Soma o transcript da sessão **+** todo sub-agente disparado a partir dela (Task/Agent tool, Workflows — ficam em `<sessionDir>/<sessionId>/subagents/**/*.jsonl`).
- **O custo é recalculado**, não copiado. O script soma tokens do transcript e dos sub-agentes contra a tabela de preço por modelo; `cost.total_cost_usd` do stdin é só fallback. Consequência prática: **este número não bate com o `/cost`** do Claude Code, e é de propósito — o `/cost` não enxerga o gasto dos sub-agentes.
- **Custo em BRL** ao lado do USD — cotação via [open.er-api.com](https://www.exchangerate-api.com/docs/free) (sem chave), cache de 12h em disco, fallback fixo se offline.
- **Ritmo de burn (🔥)** compara tokens-novos-por-minuto-ativo desta sessão contra a média histórica das suas próprias sessões (log local `.burn-log-v2.jsonl`, precisa de 3+ sessões de 1min+ ativo pra ter baseline — sem isso o segmento some em vez de arriscar leitura errada). Degraus enviesados pra baixo: sessão no ritmo normal fica 0-1 fogo (❄ se mais barata que o costume).
- Linha do **Codex** lê o `rate_limits` direto do rollout `.jsonl` mais recente em `~/.codex/sessions/`, cacheado 60s. **Opcional** — sem o Codex CLI instalado, mostra "sem dados" em vez de quebrar.
- Candidatos de Codex/git/porta **só entram no rodízio dentro de um repo** (`git rev-parse --is-inside-work-tree`).

### O que degrada fora do macOS/Linux

Nada quebra — o script trata cada fonte externa com fallback. Mas duas coisas simplesmente não aparecem no Windows:

| Segmento | Depende de | No Windows |
|---|---|---|
| Porta do dev server | `lsof` + `ps` | nunca entra no rodízio (os binários não existem) |
| ⏱ tempo ativo | `grep`/`awk` sobre o transcript | funciona se o Git Bash estiver no PATH do processo que roda o statusline; senão cai no fallback `cost.total_api_duration_ms` |

## Skills próprias

Autorais ou modificadas por mim o suficiente pra valer vendorizar aqui direto (não são um link pra repo alheio):

| Skill | Pra quê | Depende de |
|---|---|---|
| `session-build` | Leva uma ideia até branch pushada: brainstorma até virar spec, planeja, endurece o plano no `codex-review` e implementa. Uma spec roda inline; várias forkam uma sessão filha por spec | `codex` CLI, `gh`, superpowers |
| `session-end` | Fecha uma branch pronta: verifica, aplica migration, faz deploy, registra pendências, abre PR, merge e limpa branch/worktree | `gh`; `supabase` CLI **se** o projeto usar Supabase |
| `session-handoff` | Gera um prompt único e autocontido pra continuar a sessão em outra janela/agente | nada |
| `code-ultragraph-review` | Review de codebase inteiro via grafo de conhecimento (graphify) — modo `--autopilot` roda pipeline autônomo | `graphify`, `codex` CLI, `gh`, `node`; Supabase no `--autopilot` |
| `codex-review` | Loop adversarial Claude↔Codex revisando um plano antes de escrever código | `codex` CLI autenticado |

**Aviso honesto:** `session-end` e `code-ultragraph-review --autopilot` foram escritas contra o meu stack — Supabase (migrations + edge functions), GitHub via `gh`, projeto com gate de lint/typecheck/test. As duas leem o `CLAUDE.md` do projeto e obedecem ele acima dos defaults, mas os passos de migration e deploy assumem Supabase. Em projeto sem Supabase esses passos não têm o que fazer; em projeto com outro banco, adapte antes de rodar em produção.

`session-handoff` é a única sem dependência nenhuma — é a mais fácil de experimentar primeiro.

### A cadeia session-*

`session-build` vai da ideia até branch pushada e verificada, e **para ali de propósito** — não abre PR, não mergeia. Você revisa. Depois `session-end` fecha cada branch: verifica de novo, aplica migration, faz deploy, registra pendência, abre PR, mergeia e limpa branch e worktree. Quem constrói não é quem mergeia, e a fronteira é você.

`session-handoff` é ortogonal às duas — atravessa fronteira de sessão quando o contexto acaba no meio do trabalho, gerando um prompt único e autocontido pra retomar em outra janela.

Com mais de uma spec, a `session-build` deixa de construir e vira orquestradora: uma branch e um worktree por spec, uma sessão filha em cada, e ela conversa com todas por cross-session chat. O trabalho dela é ordem e colisão — worktree isola git, mas não isola o banco nem o runtime de edge function, que continuam sendo um só. Então ela serializa migration e deploy entre as filhas, manda uma esperar a outra quando existe dependência, e pode ordenar que duas se coordenem direto quando disputam a mesma função.

**[docs/cadeia-session.md](docs/cadeia-session.md)** tem o desenho completo, com fluxogramas: a topologia do fork, os locks, os cinco níveis de dependência, o único deadlock que o design consegue produzir sozinho, e a assimetria entre o que o git desfaz e o que o banco não desfaz.

## Hooks

Dois, nenhum obrigatório: o do **RTK** (`PreToolUse` em `Bash`, corta a saída de comando antes de voltar pro contexto) e o **reap-orphans** (`SessionStart`, só Windows, mata processo órfão de test runner).

O do RTK **não se escreve à mão** — `rtk init --global` o instala e mantém. O reap-orphans o `install.sh` copia mas **não liga**: hook que mata processo se liga por decisão sua, depois de rodar com `-WhatIf`.

Detalhe completo, incluindo o que acontece se o hook do RTK existir sem o binário instalado: **[docs/hooks.md](docs/hooks.md)**.

## Plugins e ferramentas de terceiro

Cada um no seu próprio repo — listo e aponto pro oficial, não vendorizo (o repo de origem já mantém isso atualizado, e evita duplicar licença/atribuição de terceiro). `./install.sh --third-party` detecta o que falta e instala ou instrui, um por um.

| Nome | Pra quê | Fonte | Instalar |
|---|---|---|---|
| `superpowers` | Brainstorming, TDD, debugging sistemático, code review — o processo por trás de toda tarefa | plugin oficial, [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | `/plugin marketplace add anthropics/claude-plugins-official` depois `/plugin install superpowers` |
| `caveman` | Modo de resposta ultra-comprimido, mantendo precisão técnica | [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) | `/plugin marketplace add JuliusBrussee/caveman` depois `/plugin install caveman` |
| `rtk` | CLI que filtra saída de `git`/`bash` antes de voltar pro contexto — corta até 90% do texto ruidoso. Ver `RTK.md` | [rtk-ai/rtk](https://github.com/rtk-ai/rtk) (Apache-2.0) | `brew install rtk-ai/tap/rtk` · Windows: [releases](https://github.com/rtk-ai/rtk/releases). Depois `rtk init --global` |
| `graphify` | Transforma qualquer pasta num grafo de conhecimento navegável — base do `code-ultragraph-review` | [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) | `uv tool install graphifyy` (ou `pipx install graphifyy`) depois `graphify install` |
| `codex` CLI | O crítico do `codex-review` e do `session-build` | [openai/codex](https://github.com/openai/codex) | `npm i -g @openai/codex` depois `codex login` |
| `impeccable` | Design/crítica de UI, sistema de design | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | `/plugin marketplace add pbakaus/impeccable` depois `/plugin install impeccable` |

Dentro do Claude Code os comandos são `/plugin ...`; fora dele, o mesmo pelo CLI: `claude plugin marketplace add <repo>` e `claude plugin install <nome>@<marketplace>`. É esse segundo caminho que o `--third-party` usa, porque roda sem TTY.

Os **três plugins** (`superpowers`, `caveman`, `impeccable`) o `--third-party` instala sozinho — são código que roda dentro do Claude Code, e o marketplace de cada um é declarado no `settings.example.json`. **RTK, graphify e codex ele não instala**: são binários no seu sistema, e instalar software na máquina de alguém sem a pessoa mandar não é papel de um instalador de config. Detecta, imprime o comando certo pro seu sistema, e para.

## Conteúdos pra assistir

Ferramenta se instala lendo o `install.sh`; critério não. **[docs/conteudos.md](docs/conteudos.md)** é a lista curta do que assistir pra entender as decisões deste repo — cada item com resumo meu, timestamps do que vale e do que pular, e as ressalvas. Não é uma pasta de links: entra só o que ensina a *operar* um agente (arquivo, cron, isolamento, o que quebra ao escalar), não o que explica o que um agente é.

Começa por **[Hermes Agent: Zero to Personal AI Assistant](docs/conteudos.md#1-hermes-agent-zero-to-personal-ai-assistant)** — o agente que continua rodando depois que você fecha o notebook, e a fronteira dele com o Claude Code.

## O que sai da sua máquina

Relevante se você for adotar isso num contexto com dado de cliente:

- **O statusline faz uma requisição de rede**: cotação USD→BRL em `open.er-api.com` (via `curl`, timeout 1.5s), sem chave e sem payload — cacheada 12h em `~/.claude/statusline/.fxrate.cache`. Offline, ou sem `curl`, cai num valor fixo. Pra desligar de vez, apague a função de câmbio: essa é a única linha do script que fala com a rede.
- **Ele escreve dois logs locais**: `.burn-log-v2.jsonl` (histórico de ritmo de tokens por sessão) e os caches. Ficam em `~/.claude/statusline/`, nunca saem da máquina, e podem ser apagados a qualquer momento — o baseline de ritmo simplesmente some até juntar 3 sessões de novo.
- **O RTK processa suas saídas de comando localmente** — é um binário local, não um serviço.
- As skills usam `gh`, `supabase` e `codex` com **as credenciais que já estão na sua máquina**. `codex-review` manda o *plano* pro modelo da OpenAI; se o plano tiver informação sensível do cliente, isso é uma saída de dados pra outro fornecedor. Vale saber antes, não depois.

## Licença

MIT — ver [LICENSE](LICENSE). As ferramentas de terceiro listadas acima têm cada uma a sua própria licença, no repo de origem.

Contribuições: ver [CONTRIBUTING.md](CONTRIBUTING.md).
