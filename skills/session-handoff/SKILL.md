---
name: session-handoff
description: Use when the user wants to hand off, transfer, pause, or continue the current session in a new session or with another agent — asks for a "session handoff", a "prompt para a próxima sessão", to "continuar de onde paramos", or invokes /session-handoff; also when context is running low and in-flight work must survive a session boundary. Produces one self-contained, copy-pasteable prompt.
---

# Session Handoff

## Overview

The next agent has **zero memory of this session**. The handoff prompt is its only inheritance — it must make that agent fully autonomous from a cold start, built from **fresh evidence, not your recollection**.

**Core principle:** brief on the past, complete on the present and the future. The next agent doesn't need a changelog of how we got here — it needs to know exactly what is true *now* and what to do *next*.

## When to Use

- User asks for a handoff / prompt for the next session / "continuar de onde paramos"
- User invokes `/session-handoff`
- Context is running low and work must cross a session boundary

**Not for:** writing project docs, commit messages, or PR descriptions. Those are artifacts about the work; a handoff is an instruction set for the next agent.

## The Iron Rule: Evidence Before Writing

**Never write the handoff from memory.** Your recollection drifts — commit hashes, file names, and "done" status get fabricated. Gather real evidence first, every time, even for a short session.

Run and read the output of:

```bash
git -C <repo> status              # uncommitted / modified / untracked files — what is NOT saved
git -C <repo> log --oneline -15   # recent commits — confirm hashes & messages, don't guess
git -C <repo> branch --show-current
git -C <repo> diff --stat         # scope of uncommitted changes
```

Then review **this conversation** for: the goal, decisions made and *why*, the task in flight, blockers, and open questions. Check any open TODOs (TaskList / TodoWrite state).

If a fact isn't in the evidence or the conversation, **do not invent it** — either verify it or label it `(a confirmar)`.

## Output Contract

- Emit the handoff as **ONE fenced code block** so the user copies it in a single gesture.
- The block must be **self-contained**: the next agent needs nothing but the repo + this prompt. No "as discussed", no references to *this* chat.
- Outside the block: at most one line ("Pronto — é só copiar o bloco abaixo para a próxima sessão.").
- **Past = a few sentences. Present + Future = exhaustive.**
- State `git`/branch facts exactly as the commands returned them.

## Handoff Template

Emit this structure inside the fenced block. Adapt headings to the project's language (PT-BR for this user's projects).

```
# Handoff — <projeto> / <linha de trabalho em 1 frase>

## De onde viemos (curto — 2 a 4 frases)
<O objetivo desta linha de trabalho e o contexto mínimo necessário. Sem changelog.>

## Estado atual (completo)
- **Tarefa em foco:** <o que estávamos fazendo no momento do corte>
- **Decisões tomadas + porquê:** <cada decisão de design/arquitetura e a razão — para o próximo agente não reabrir o que já foi resolvido>
- **Git:** branch `<branch>`; últimos commits relevantes `<hash msg>`; working tree: <limpo | arquivos modificados/untracked listados>
- **Feito e verificado:** <com a evidência: testes passando, build limpo, EXPLAIN, etc.>
- **Feito mas NÃO verificado:** <o que foi escrito mas ainda não provado>
- **Em andamento (incompleto):** <onde exatamente parou, em qual arquivo/função>

## O que falta (completo)
1. <Próximo passo concreto, acionável, em ordem — com caminho de arquivo (path:linha) quando aplicável>
2. <...>
- **Perguntas em aberto / decisões pendentes:** <o que precisa de input do usuário>
- **Bloqueios e gotchas:** <armadilhas conhecidas, dependências, coisas que quebram silenciosamente>
- **Arquivos-chave:** <path:linha — ponteiros para onde o próximo agente deve olhar primeiro>

## Como retomar
- **Primeiro passo sugerido:** <a primeira ação concreta>
- **Convenções/constraints a respeitar:** <derive do CLAUDE.md e docs do repo — não assuma>
- **Idioma / barra de "concluído":** <ex.: PT-BR; nada é "feito" sem evidência fresca>
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Writing from memory; `tool_uses: 0` | Run the git commands first. Quote real output. |
| Guessing commit hashes / file names | Verify each against `git log` / `git status`. Label unverified as `(a confirmar)`. |
| Long "o que já foi feito" changelog | History is 2–4 sentences. Detail belongs in present/future. |
| Loose markdown, hard to copy | One fenced block, self-contained, nothing referencing this chat. |
| "Done" without distinguishing verified vs unverified | Split into feito-e-verificado / feito-não-verificado / em-andamento. |
| Vague next steps ("continuar o trabalho") | Ordered, actionable, with `path:linha`. |
| Constraints assumed instead of read | Pull conventions from the repo's CLAUDE.md/docs. |
