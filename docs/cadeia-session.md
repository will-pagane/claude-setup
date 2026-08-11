# A cadeia `session-*`

Três skills dividem o ciclo de vida de uma sessão de trabalho. Uma leva a ideia até branches prontas, outra leva a branch até a `main`, e a terceira mantém o trilho contínuo quando a sessão acaba no meio do caminho.

| Skill | Aresta que cruza | Estado terminal |
|---|---|---|
| [`session-build`](../skills/session-build/) | ideia → branch | N branches pushadas e verificadas |
| [`session-end`](../skills/session-end/) | branch → `main` | merge feito, produção em dia, branch e worktree apagados |
| [`session-handoff`](../skills/session-handoff/) | sessão → sessão | um prompt único e autocontido |

---

## O mapa

A confusão comum é achar que as três são etapas de uma mesma esteira. Não são. `build` e `end` ficam no mesmo trilho, em pontos diferentes, separados por uma coisa que nenhuma das duas faz: a sua revisão. `handoff` está em outro eixo — ele cruza o limite da sessão, e pode ser chamado em qualquer ponto do percurso.

```mermaid
flowchart LR
    ideia([ideia]) --> build["/session-build"]
    build --> branch["branches pushadas<br/>e verificadas"]
    branch --> rev{{você revisa}}
    rev --> fim["/session-end"]
    fim --> main([main atualizada, branch e worktree apagados])

    build -. "contexto acabou aqui" .-> ho["/session-handoff"]
    rev -. "ou aqui" .-> ho
    fim -. "ou aqui" .-> ho
    ho -. "prompt único e autocontido" .-> nova([próxima sessão retoma do zero])
```

Cada uma tem uma fronteira que nunca cruza:

- **`build` nunca** abre pull request, mergeia, ou chama `finishing-a-development-branch`. Nem "pra ajudar".
- **`end` nunca** abre trabalho novo. Bug achado no meio vira pendência escrita, não um fix improvisado.
- **`handoff` nunca** escreve de memória. Sem `git status` e `git log` lidos, não há handoff.

---

## `/session-build` — ideia → branch

Começa num brainstorm e termina em branches verificadas e pushadas.

> **Não é disparar e sair.** O run só fica autônomo quando o escopo fecha. Antes disso existem dois portões seus: o `brainstorming` exige que você aprove o design e revise cada spec, e o passo de escopo termina com você confirmando ordem e regras de colisão. Um run lançado e abandonado antes disso estaciona na primeira pergunta — corretamente, mas em silêncio.

### Uma spec ou várias

O brainstorm é quem decide o tamanho do trabalho. Se a ideia cabe num spec só, a própria sessão faz tudo em linha. Se ela se decompõe em vários, a sessão **forka a si mesma** — uma sessão filha por spec — e vira orquestradora, sem escrever uma linha de código a partir dali.

```mermaid
flowchart TD
    p["/session-build ‹ideia›"] --> br["brainstorming<br/>gates seus"]
    br --> n{quantas specs?}

    n -- "1" --> inline["esta sessão faz tudo em linha"]
    inline --> i1["plan → codex-review → SDD → verificação → push"]
    i1 --> o1([1 branch pushada])

    n -- "2 ou mais" --> orq["esta sessão vira ORQUESTRADORA<br/>não escreve código"]
    orq --> f1["fork · spec-a"]
    orq --> f2["fork · spec-b"]
    orq --> f3["fork · spec-c"]
    f1 --> o2([N branches pushadas])
    f2 --> o2
    f3 --> o2
```

A diferença entre forkar e disparar um subagente comum é o que a filha sabe ao nascer: **o fork herda a conversa inteira**. Ela já viu o brainstorm, já conhece os outros specs e já sabe por que o dela existe. O prompt de despacho carrega só o que foi decidido *depois* do fork.

Cada filha é nomeada pelo slug do seu spec — `description: "spec ‹slug›"` é a única alavanca de nome que o `Agent` expõe, e esse valor vira o endereço dela no `ListAgents`. Sem isso, uma filha aparece como um handle hexadecimal aleatório no meio de dezenas de peers.

### O gargalo que o git não resolve

Worktree isola git. Não isola o banco de produção nem o edge runtime — esses continuam sendo um só para todas as sessões. É aí que duas branches paralelas se destroem em silêncio: a segunda a deployar a mesma edge function reverte a primeira, e nenhum teste local acusa.

```mermaid
flowchart LR
    a["fork · spec-a<br/>worktree e branch próprios"]
    b["fork · spec-b<br/>worktree e branch próprios"]
    c["fork · spec-c<br/>worktree e branch próprios"]

    a -. "LOCK migration · espera" .-> o
    b == "GO" ==> o
    c -. "LOCK deploy · espera" .-> o

    o{{"ORQUESTRADORA<br/>concede 1 lock por vez<br/>espera APPLIED antes do próximo GO"}}

    o ==> db[("1 banco de produção<br/>migrations · ledger remoto")]
    o ==> rt["1 edge runtime<br/>deploy sobrescreve deploy"]
```

A orquestradora existe para ser esse gargalo. A ordem de concessão vem da regra de colisão decidida no começo, não da ordem de chegada.

### As cinco fases de cada fork

1. **Plano** — `writing-plans` em `docs/superpowers/plans/`. Migrations e deploys entram como tasks explícitas do plano, cada uma com verificação própria; não são uma etapa separada depois.
2. **Codex review** — loop adversarial até `APPROVED` ou o teto de rodadas. O passo que ninguém pode pular: **copiar o plano endurecido de volta** para o caminho que a implementação lê. O `codex-review` trabalha dentro do run dir dele; sem o copy-back, você revisa um plano e implementa outro.
3. **Manifesto de superfícies** — a filha declara o que o plano endurecido vai tocar (migrations, tabelas, edge functions, módulos compartilhados, arquivos) e **para**. Nenhum `GO` sai antes do último manifesto chegar.
4. **Implementação** — `subagent-driven-development` até o fim, com o final da skill sobrescrito. Migration e deploy só acontecem com lock concedido.
5. **Verificação e push** — lint, typecheck, build e testes rodados e *lidos* pela dona da branch. Relatório de subagente não conta como prova.

### O protocolo do cross-session chat

Filha fala com a orquestradora por `SendMessage to: "main"`; a orquestradora responde pelo nome. Toda filha também escreve os checkpoints no próprio arquivo de ledger — canal de reserva e registro durável depois de uma compactação.

| Mensagem | Direção | Significa |
|---|---|---|
| `SURFACES` | filha → orq. | o que meu plano vai tocar; estou parada esperando |
| `LOCK migration` | filha → orq. | preciso do banco; não aplico sem `GO` |
| `LOCK deploy` | filha → orq. | preciso do runtime; não deployo sem `GO` |
| `APPLIED` / `DEPLOYED` | filha → orq. | terminei e verifiquei; o lock está livre |
| `PUSHED` / `DONE` | filha → orq. | branch no remoto; libera quem dependia de mim |
| `BLOCKED` | filha → orq. | travei; escala para o humano |
| `GO` | orq. → filha | lock concedido ou dependência satisfeita |
| `HOLD` | orq. → filha | pare antes da próxima fase |
| `COORDINATE WITH` | orq. → filha | fale direto com a irmã e acordem dona e ponto de merge |
| `MERGE ‹branch› BEFORE ‹task›` | orq. → filha | traga a branch dela antes de tocar nisso |
| `REASSIGN` | orq. → filha | essa superfície não é mais sua |

### O único deadlock que o desenho produz sozinho

A regra de liveness — "filha muda uma fase inteira leva ping" — tem um ponto cego: **quem espera um `GO` fica calado por definição**. Parece ociosa, não bloqueada. Se o contexto da orquestradora compacta entre o pedido e a concessão, o pedido some e a filha espera para sempre, aparentando saúde perfeita.

```mermaid
sequenceDiagram
    participant F as fork · spec-b
    participant O as orquestradora

    F->>O: LOCK migration ‹arquivo›
    Note over F: fica calada esperando GO<br/>parece ociosa, não bloqueada
    Note over O: contexto compacta<br/>o pedido some do contexto
    Note over F,O: deadlock — ninguém errou, ninguém avança

    O->>O: varredura dos ledgers a cada toque<br/>procura LOCK sem concessão
    F->>O: LOCK migration ‹arquivo› (reenvio, ~10 tool calls)
    O->>F: GO
```

Reenvio não é ruído: é sintoma de que uma concessão caiu.

### Quando o run precisa parar

`HOLD` vale no **próximo limite de fase**, nunca no meio. Uma filha segurando lock **termina a operação e solta antes de parar** — migration meio aplicada é pior que qualquer atraso que a parada tentava comprar. Depois, a orquestradora reporta o estado exato de cada filha: o que completou, o que segura, o que ia fazer.

### Dependência não é sim ou não — é quanto

| Nível | O que é | De onde a branch de B sai |
|---|---|---|
| **Independente** | nenhuma superfície em comum | da `main`, paralelo do começo ao fim |
| **Soft** | B só precisa conhecer a interface de A | da `main`; a orquestradora relaya a decisão |
| **Parcial** | só algumas tasks de B dependem de A | da `main`, **começa já** — plano ordenado com as tasks livres primeiro |
| **Total** | B importa A inteiro, ou o schema de A | **da branch de A**, depois do `PUSHED` |
| **Emaranhado** | as duas teriam que editar o mesmo código ao mesmo tempo | não é dependência: é erro de decomposição → vira 1 spec, 1 fork, em série |

**Parcial é o caso comum e o que paga** — B constrói enquanto A constrói, em vez de ficar ociosa:

```mermaid
gitGraph
    commit id: "base"
    branch spec-a
    commit id: "A implementa"
    checkout main
    branch spec-b
    commit id: "B tasks livres"
    checkout spec-a
    commit id: "A PUSHED"
    checkout spec-b
    merge spec-a
    commit id: "B tasks dependentes"
```

**Total** é o único nível que troca a base da branch — e por isso é o que também define ordem de merge:

```mermaid
gitGraph
    commit id: "base"
    branch spec-a
    commit id: "A implementa"
    commit id: "A PUSHED"
    branch spec-b
    commit id: "B nasce daqui"
```

Duas regras fecham o assunto:

- **Duas sessões nunca dividem worktree, em nenhum nível.** Dependência é *temporal, não espacial*: quem espera o código do outro não conseguiria construir naquele diretório de qualquer jeito. Compartilhar não compraria paralelismo nenhum — só importaria disputa de `index.lock`, verificação lendo arquivo meio-escrito do vizinho, e gate falhando por quebra alheia.
- **O grafo precisa ser acíclico, e alguém precisa dizer isso em voz alta.** Qualquer ciclo é emaranhado por definição. Ciclo deixado no grafo trava o run, e trava *tarde*, depois das duas filhas já terem planejado e construído.

### O que não volta atrás

Git é descartável; banco de dados não. Existe um banco só, sem staging atrás dele. Se um fork aplica a migration e a implementação trava depois, a branch pode ser jogada fora — o que já entrou no schema fica.

```mermaid
flowchart LR
    t1[código] --> t2[código + testes] --> t3[verificação] --> mig["migration<br/>(o mais tarde que o plano permitir)"] --> dep[deploy]

    dep -. "falha aqui" .-> ab([branch abandonada])
    ab -- "git desfaz a branch inteira" --> zero([código volta ao zero])
    mig -- "o banco não desfaz nada" --> fica["fica em produção<br/>relatório: Aplicado sem código"]
```

Por isso a task de migration é ordenada o mais tarde possível, depois do código que depende dela estar escrito e verificado — e o relatório final tem uma seção só para nomear cada migration que ficou no banco com a branch abandonada. Essa seção vir vazia é uma afirmação, então só é feita depois de conferir.

### Com quem você fala

**Durante o run: a orquestradora, sempre.** Ela é a única sessão com o quadro inteiro e a única que concede lock de migration e de deploy. Uma instrução mandada direto a uma filha atropela isso: a orquestradora ainda acredita que a filha está parada e pode conceder o lock a outra — dois `db push` simultâneos contra um banco só é exatamente o que a serialização existe para impedir. Quer um detalhe de uma filha? Pergunte à orquestradora; ela pergunta e relaya.

**Depois do run: `/session-end` roda dentro do fork dono da branch**, não na orquestradora. Isso é mecânico, não estilístico — `session-end` lê `git branch --show-current` de dentro do worktree e precisa sair dele para removê-lo no fim. A orquestradora fica no checkout principal e não pode estar dentro de N worktrees. A filha já está no lugar certo, e ainda tem o que a etapa de pendências precisa: o que ela adiou, o que cortou, e o que a suíte de testes realmente imprimiu.

Se você preferir nunca sair da orquestradora, ela pode entrar em cada worktree e rodar `/session-end` ela mesma, uma vez por branch, em ordem de merge. Custa um contexto absorvendo N fechamentos, e pendências escritas a partir de um relatório em vez da memória de quem construiu.

---

## `/session-end` — branch → `main`

É o único lugar onde abrir PR e mergear estão autorizados: a invocação **é** o pedido. Em troca, tudo antes do merge é portão duro.

```mermaid
flowchart LR
    b[branch pushada<br/>revisada por você] --> v[verificação completa]
    v --> m[migrations conferidas<br/>contra o ledger remoto]
    m --> d[deploy verificado<br/>por re-download e grep]
    d --> g{hard gate}

    g -- "algo vermelho" --> stop([para e reporta])
    g -- "tudo verde" --> pr[pull request] --> mg["merge --merge<br/>nunca --squash"]

    mg --> pos[pós-merge:<br/>redeploy + types + pull]
    pos --> lim[limpeza: worktree,<br/>branch local e remota]

    mg -. "o merge reverte o deploy de branch" .-> d
```

A seta pontilhada de volta é a armadilha que não aparece em teste nenhum: em hosts que redeployam em massa a cada push na `main`, o merge silenciosamente reverte o deploy feito na branch. Por isso existe um redeploy **depois** do merge, verificado de novo por download.

O que trava o merge, sem exceção: lint, build ou teste vermelho; migration da branch ausente do ledger remoto; finding de review não resolvido; working tree suja; conflito com a `main`.

Duas outras regras que valem citar:

- **Pendência tem forma.** O que ficou para trás vira item escrito com três respostas obrigatórias — o que é, por que não foi feito agora, e quanto custa. Item sem "por que" é uma task que você deveria ter feito; item sem custo é um desejo. Nada adiado, nenhum arquivo: um arquivo de pendências vazio é ruído.
- **A limpeza se recusa a perder trabalho.** Sai do worktree primeiro, confere que não há commit fora da `main` nem arquivo sujo, e usa `git branch -d` minúsculo — o que se recusa a apagar trabalho não mergeado.

---

## `/session-handoff` — sessão → sessão

O próximo agente tem memória zero. O bloco é a herança inteira dele.

```mermaid
flowchart LR
    subgraph ev["evidência fresca, lida agora"]
        s["git status"]
        l["git log --oneline -15"]
        df["git diff --stat"]
        cv["a conversa: decisões e porquês"]
    end

    ev --> bl["um bloco fenced<br/>passado: 2 a 4 frases<br/>estado atual: completo<br/>o que falta: completo<br/>como retomar"]
    bl --> px([próxima sessão · memória zero])
```

Duas regras carregam a skill:

- **Evidência antes de escrever.** Nunca de memória — recollection inventa hash de commit e nome de arquivo com toda a confiança do mundo. Se um fato não está na evidência nem na conversa, ele é verificado ou marcado `(a confirmar)`.
- **A proporção é a regra.** Passado curto, presente e futuro exaustivos. E o estado atual separa três coisas que todo mundo mistura: feito e verificado com evidência, feito mas não provado, e em andamento — com o arquivo e a função exatos onde parou.

---

## Por que o desenho é assim

Cada regra existe porque a falha correspondente já aconteceu, e quase nenhuma dessas falhas aparece em teste local.

| Mecanismo | Sem ele |
|---|---|
| Fork herda o contexto | cada filha reinterpreta o spec do zero |
| Um lock por vez no banco e no runtime | o segundo deploy reverte o primeiro e ninguém percebe |
| Manifesto de superfícies antes do código | a colisão só aparece com as duas já tendo escrito código |
| Varredura de `LOCK` sem concessão | o único deadlock possível, com a filha parecendo saudável |
| Copy-back do plano endurecido | você revisa um plano e implementa outro |
| Migration ordenada o mais tarde possível | produção carrega o schema de uma feature que nunca existiu |
| Nunca dividir worktree | disputa de `index.lock` e build lendo arquivo meio-escrito do vizinho |
| Um interlocutor por vez | a orquestradora acha que a filha está parada e concede o lock a outra |
| Ledger em vez de memória | o relatório final vira ficção bem-intencionada |
| Fronteira dura no PR | código não revisado entra na `main` enquanto você olha outra coisa |
| Evidência antes de afirmar | "passou" vira uma frase, não um fato |
| Gate do projeto é lei | o gate vira sugestão e para de proteger qualquer coisa |

---

## Onde ficam os arquivos

```
skills/session-build/SKILL.md              o fluxo inteiro, do brainstorm ao push
skills/session-build/dispatch-prompts.md   o contrato que cada fork recebe
skills/session-end/SKILL.md                o fechamento, portão a portão
skills/session-end/pendings-template.md    o cabeçalho do arquivo de pendências
skills/session-handoff/SKILL.md            o template do bloco de handoff
```

O `install.sh` symlinka cada pasta de `skills/` para o `~/.claude`, então um `git pull` aqui atualiza a skill instalada. Se o `~/.claude/skills/‹nome›` já existia como diretório real, o script pula (`SKIP`) em vez de sobrescrever — nesse caso as duas cópias não estão ligadas por nada, e uma edição feita em `~/.claude` não chega neste repo sozinha.
