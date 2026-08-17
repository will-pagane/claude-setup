# Conteúdos pra assistir

Lista curada de vídeos e cursos que mudaram alguma decisão deste setup — não uma pasta de links "interessantes". Cada item aqui responde por que está aqui: o que ele ensina que não estava no `README`, e o que dele vale ou não vale copiar.

**Critério de entrada:** o conteúdo precisa ser sobre *como operar um agente*, não sobre *o que um agente é*. Demo de prompt bonito não entra. Entra o que mostra estrutura — arquivo, hook, cron, isolamento, o que quebra quando escala.

**Como ler cada entrada:** o resumo é meu, não a descrição do autor. Os timestamps são os do próprio vídeo, pra você pular direto pro pedaço que interessa. Quando um vídeo tem patrocínio ou funil de curso no meio, eu digo — não pra desqualificar, pra você saber onde acelerar.

---

## 1. Hermes Agent: Zero to Personal AI Assistant

| | |
|---|---|
| **Link** | https://www.youtube.com/watch?v=gb5TlGw6Uks |
| **Canal** | [Nate Herk \| AI Automation](https://www.youtube.com/@nateherk) |
| **Duração** | 58 min |
| **Publicado** | 10/05/2026 |
| **Idioma** | inglês (legenda automática decente) |

Walkthrough completo de subir um **Hermes Agent** do zero num VPS: instalação na Hostinger, conexão com Telegram, primeira skill, primeiro cron job e backup do estado no GitHub. É o vídeo que faz o conceito de "agente pessoal persistente" sair do abstrato — você vê os arquivos, o servidor e o que acontece quando o agente acorda sozinho às 6h.

### Por que está aqui

Este repo é uma config de **Claude Code**: sessão que você abre, trabalho que você acompanha, terminal. O Hermes ocupa o espaço vizinho — o agente que continua rodando quando você fecha o notebook. O vídeo é honesto sobre a fronteira: o próprio autor não troca um pelo outro, usa Claude Code pro trabalho de terminal e Hermes pro que precisa ser proativo e agendado. Vale assistir justamente pra enxergar essa fronteira antes de tentar transformar seu Claude Code em algo que ele não é.

O segundo motivo é que os **cinco pilares** do Hermes são uma taxonomia melhor do que a que eu usava pra pensar em contexto de agente — e três deles têm equivalente direto aqui neste setup:

| Pilar (Hermes) | O que é | Equivalente neste repo |
|---|---|---|
| **Memória** | `user.md` (quem você é, preferências) + `memory.md` (projetos, contexto de negócio), carregados no início da sessão | `CLAUDE.md` global + os arquivos de memória do Claude Code |
| **Skills** | memória procedural — playbook reutilizável de "como fazer bem esta tarefa" | `skills/` — as `session-*`, `codex-review`, `code-ultragraph-review` |
| **Soul** (`soul.md`) | personalidade do agente, separada do conhecimento — permite N agentes com o mesmo cérebro e vibes diferentes | sem equivalente; o mais perto é o plugin `caveman` |
| **Cron** | agendamento em linguagem natural, com o loop agêntico completo por trás | sem equivalente local — é a principal vantagem do Hermes sobre Claude Code aqui |
| **Loop de auto-melhoria** | trabalho feito vira memória e skill nova; sessões antigas ficam pesquisáveis num banco | parcialmente: as skills evoluem, mas por edição minha, não sozinhas |

A frase que mais vale do vídeo é sobre esse último pilar: **"automático não significa mágico"**. O loop só funciona quando você corrige o agente, manda ele salvar na memória de propósito e deixa ele virar skill *depois* de um trabalho complexo dar certo. É exatamente a mesma disciplina que faz um `CLAUDE.md` prestar — o arquivo não fica bom por acúmulo, fica bom por curadoria.

### Timestamps

| Tempo | Trecho | Vale? |
|---|---|---|
| 0:00 | Intro | pode pular |
| 3:30 | O que é o Hermes Agent | sim |
| 4:30 | Hermes vs Claude Code vs OpenClaw | **a parte mais útil** se você já usa Claude Code |
| 7:30 | Os cinco pilares | **sim** — é a espinha conceitual |
| 16:30 | Setup do VPS | só se você for instalar (é aqui que mora o patrocínio) |
| 25:30 | Onboarding e Telegram | sim, se for instalar |
| 33:00 | Backup no GitHub e primeiro cron | **sim** — versionar o estado do agente é o que separa brinquedo de ferramenta |
| 46:30 | Boas práticas e segurança | **sim**, mesmo sem instalar — onde colocar API key, o que nunca vai pra memória |
| 50:30 | Escalar múltiplos agentes | sim, se você pensa em rodar mais de um |
| 56:00 | Considerações finais | pode pular |

### Ressalvas

- **Tem patrocínio de VPS** (Hostinger, com código de desconto) e link pra comunidade paga do autor. O conteúdo técnico não depende de nenhum dos dois: o Hermes roda em qualquer VPS, e o vídeo sozinho basta pra instalar.
- **Segredo não vai pra memória.** O vídeo trata disso em 46:30, e vale repetir aqui porque o erro é fácil: `memory.md` e `user.md` entram no contexto do modelo a cada sessão. API key ali dentro é API key vazada em todo prompt. O mesmo vale pro `CLAUDE.md` deste repo.
- **É um agente com acesso ao seu servidor, disparando sozinho por cron.** O modelo de ameaça é diferente do de uma sessão de Claude Code que você acompanha na tela. Se for rodar isso com dado de cliente, leia o [O que sai da sua máquina](../README.md#o-que-sai-da-sua-máquina) do README com essa lente antes.

---

## Sugerir um conteúdo

Abra uma issue ou um PR editando este arquivo, seguindo o formato acima: link, canal, duração, data, um resumo do que o conteúdo ensina, por que ele importa pra quem usa este setup, e as ressalvas. Resumo copiado da descrição do autor não entra — a lista existe pra economizar o tempo de quem lê, e descrição de vídeo é material de marketing.
