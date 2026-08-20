# Specification: Fluxo do incidente — duas entradas, marcos de prazo e read model

**Track ID:** incident-flow_20260819
**Type:** Feature
**Created:** 2026-08-19
**Status:** Draft

## Summary

Construir o fluxo que acompanha a ocorrência enquanto ela está viva: receber evento das duas
naturezas de origem, guardar o corpo intacto antes de qualquer interpretação, traduzir num estágio
próprio, emitir marcos conforme o prazo é consumido e consolidar a quebra no fechamento.

Muda também o vocabulário: hoje um único termo cobre o que chega de qualquer origem, e com duas
naturezas distintas isso não se sustenta — os nomes e os campos que o sistema publica são revistos
aqui.

O desenho completo, com as evidências que o sustentam, está em
[`docs/insights/fluxo-do-incidente.md`](../../../docs/insights/fluxo-do-incidente.md).

## Context

O sistema hoje é inteiramente reativo a evento de origem: chega incidente, roda análise. Não existe
nada que reaja à passagem do tempo — e é justamente o tempo que consome o prazo do OLA.

A engenharia reversa sobre o histórico mostrou por que isso importa. A violação de OLA na Locaweb
não é calculada, é apurada depois do mês fechado; quando alguém sabe que o prazo foi perdido, não há
mais o que fazer sobre aquele incidente. O produto existe para trazer esse julgamento para dentro da
janela em que ele ainda muda o desfecho.

Três achados sustentam o desenho:

- **O consumo de prazo sozinho já é um preditor forte.** Um incidente de severidade 3 que passou de
  75% do prazo estoura em 87% dos casos; em 25%, em 46%. Sem modelo — só tempo decorrido contra o
  prazo da prioridade. 35% dos incidentes elegíveis vivem tempo suficiente para serem reavaliados.
- **As origens não são de uma natureza só.** Gerenciadores de serviço entregam ciclo de vida, dono,
  reconhecimento humano e prazo contratual; ferramentas de monitoração entregam uma condição que
  persiste ou cessa. Tratá-las com um contrato único produz campos vazios carregando semântica
  ambígua.
- **O vocabulário atual assume uma origem só.** O termo que descreve o que trafega hoje foi cunhado
  quando existia apenas um sistema de origem. Com duas naturezas, ele precisa ser dividido — e isso
  muda nome de campo, de tópico e de tabela.

## User Story

Como operador, quero ser avisado enquanto o incidente ainda está aberto e o prazo ainda dá para ser
cumprido, em vez de descobrir a violação na apuração do mês seguinte.

Como gestor, quero ver a projeção de fechamento dos KPIs do mês em uma tela, em vez de esperar o
fechamento para saber se a meta foi atingida.

## Acceptance Criteria

- [ ] Uma origem do tipo `alert` e uma do tipo `monitor` entregam no mesmo gateway, cada uma pelo seu
      contrato, sem campo vazio carregando semântica
- [ ] Um incidente aberto gera marcos aos 25%, 50%, 75% e 100% do prazo da sua prioridade
- [ ] O marco de 100% constata o estouro; nenhum marco de prazo é emitido depois dele
- [ ] O fechamento do incidente consolida a quebra — duração, se estourou e por quanto
- [ ] O vocabulário do domínio distingue o que vem de cada natureza de origem, sem termo herdado de
      quando existia uma só
- [ ] Os marts continuam produzindo os mesmos números depois de mudarem de cadeia
- [ ] O corpo da origem é gravado antes de qualquer interpretação, e um recorte por origem e período
      é lido sem abrir o corpo
- [ ] Corrigir o dicionário e reprocessar um período produz resultado novo sem perder o anterior
- [ ] Nenhum consumidor de negócio precisa conhecer vocabulário de origem

## Dependencies

- Camadas 1 e 2 em `main` — atendido
- `ml-model-serving` no ar com os modelos em `Production` — atendido
- Refatoração de adapters por origem no `ui-gateway` — está no working tree, não commitada
- Track `mvp-closeout_20260817` (PR #56) cobre copiloto, painel N1/N2 e Slack; o que estiver aqui não
  se sobrepõe a ela

## Out of Scope

- Interface e o que ela consome — track própria, criada depois desta, quando os nomes e os campos
  publicados aqui estiverem definidos
- Copiloto e recomendação gerada por LLM — Sprint 4, track `mvp-closeout_20260817`
- Armazenamento de embeddings e auditoria de chamadas de LLM
- Carga completa do histórico e medição de qualidade preditiva dos modelos
- Substituir o julgamento da apuração da Locaweb: o sistema produz o fato técnico, não reproduz a
  decisão de negócio deles
- Escrever de volta na origem — os gerenciadores expõem endpoint de atualização e de comentário, e o
  caminho existe (a recomendação viraria anotação no próprio chamado, o botão do canal daria o
  reconhecimento de verdade). Fica fora porque é ação com efeito em sistema de terceiro, exige
  credencial de escrita e uma decisão explícita sobre o que o sistema pode fazer sozinho — e porque
  antes do copiloto existir há pouco a escrever. Se entrar, começa por anotação, que é aditiva, e
  precisa de marcação de autoria própria para o sistema não reagir ao que ele mesmo escreveu

## As camadas

Os nomes vêm de uma convenção comum de arquitetura de dados. O que separa uma camada da outra não é
a tecnologia nem o tamanho — é **quanta interpretação já foi aplicada** e **qual a granularidade de
uma linha**.

### Raw — o que chegou

O corpo do evento como a origem mandou, sem nenhuma interpretação, com um envelope mínimo em volta.
Uma linha por evento recebido, append-only: nada é atualizado, nada é apagado, tudo é acrescentado.

Se todas as camadas acima forem apagadas, elas se reconstroem a partir daqui — é essa propriedade que
torna o raw a fonte da verdade, e é o que permite corrigir o dicionário e reprocessar o passado.

### Bronze — o que chegou, no nosso vocabulário

O mesmo evento, ainda um por linha, com nomes e valores traduzidos para o domínio. Nenhuma
derivação: tradução é mapa fixo sobre um evento por vez.

É a partir daqui que os consumidores de negócio leem — nenhum deles precisa conhecer o vocabulário de
nenhuma origem.

### Silver — o que é

O estado de cada coisa, montado a partir da sequência de eventos. Aqui deixa de ser uma linha por
evento e passa a ser **uma linha por ocorrência**: cinco eventos do mesmo chamado viram um registro
com o estado dele.

É onde vivem as derivações que exigem olhar mais de um evento — quando alguém assumiu, quanto durou,
quanto do prazo já foi consumido. Nenhuma delas é possível no bronze, porque cada evento sozinho não
sabe o que veio antes.

### Gold — o que significa

Agregação e veredito de negócio. Aqui não se fala mais de uma ocorrência individual, e sim de
conjunto: por período, por recurso, por grupo responsável.

É o que responde perguntas de negócio — quantos estouraram este mês, qual recurso concentra
repetição, qual grupo está sobrecarregado agora.

### O mesmo caso nas três camadas

Um chamado de severidade 3 (prazo de 12 horas) abre às 08:00, alguém assume às 09:30, é resolvido às
14:00:

| Camada | O que existe |
|--------|--------------|
| Raw | três linhas — o corpo de cada webhook que a origem enviou, intacto |
| Bronze | as mesmas três linhas, com os nomes e valores no vocabulário do domínio |
| Silver | uma linha — abriu 08:00, assumido 09:30, resolvido 14:00, durou 6h, consumiu 50% do prazo, não estourou |
| Gold | contribui para "em agosto, 340 chamados de severidade 3, 12 estouraram, tempo mediano de 1h45" |

### Como decidir onde uma informação vai

- Se ela vem no próprio evento, é **bronze** — basta traduzir o vocabulário.
- Se é preciso olhar outros eventos da mesma ocorrência, é **silver**.
- Se é preciso olhar outras ocorrências, é **gold**.

O erro que essa régua evita é o mais comum: calcular no lugar errado. Duração parece campo de
ingestão, mas depende de dois eventos — é silver. Taxa de violação parece derivação da ocorrência,
mas só existe sobre um conjunto — é gold.

---

## Ingestão, tradução e camadas

O gateway não traduz. Ele autentica a origem, envelopa o corpo como veio e publica. A tradução é um
estágio próprio, logo depois, com um dicionário que vive fora do código.

```
origem ──▶ gateway ──▶ tópico cru ──▶ bronze (envelope + corpo intacto)
                                          │
                             tradução (dicionário versionado)
                                          │
                                          ├──▶ tópico traduzido ──▶ consumidores
                                          └──▶ silver (estado atual + derivações)
                                                              │
                                                              └──▶ gold
```

Isso preserva a regra da ACL — nenhum consumidor de negócio vê vocabulário de origem, porque todos
leem depois da tradução — e ganha o que a tradução na fronteira não dava: **o corpo original fica
como linha de primeira classe, então corrigir o dicionário e reprocessar o passado é uma execução,
não uma arqueologia dentro de um campo de texto**.

### Raw — envelope tipado, corpo opaco

| Campo | Tipo | Origem do valor |
|-------|------|-----------------|
| `event_id` | uuid | atribuído |
| `source` | string | atribuído — rota e credencial da integração |
| `intake` | enum `alert` / `monitor` | atribuído — pela rota |
| `version` | string | atribuído — versão do formato do envelope |
| `received_at` | timestamp | atribuído |
| `payload` | string | o corpo da origem, intacto |

Nada de negócio é tipado aqui. O que existe fora do `payload` é o mínimo para autenticar, particionar
e reprocessar. Em arquivo, isso é Parquet particionado por `source` e por data de recepção: o corpo é
uma coluna de texto, comprime bem porque as chaves se repetem, e um recorte por origem e período é
resolvido sem abrir o payload.

### O dicionário de tradução

O bronze registra qual versão do dicionário produziu cada linha, em campo próprio — `version` ali é a
versão do contrato traduzido, e as duas coisas mudam por motivos diferentes.

O dicionário vive fora do código dos consumidores e é versionado, não mutável em produção. Versionado importa por
uma razão específica: reprocessar 2025 com o dicionário de hoje reproduz o que *aconteceria* hoje,
não o que aconteceu. Sem versão, o reprocessamento perde a capacidade de explicar o passado.

Cada origem tem seu dicionário: os valores que ela usa para ciclo de vida, para condição e para o que
originou o registro, mapeados no vocabulário do domínio. Valor fora do dicionário vira o caso
desconhecido e fica visível — nunca falha o evento, porque o corpo original está preservado e o mapa
pode ser estendido depois.

### Reprocessamento

Corrigir o dicionário e reprocessar muda números que podem já ter sido reportados. A política precisa
ser explícita: **o resultado da tradução é versionado, e o período já fechado não é sobrescrito em
silêncio**. Um indicador de mês fechado que muda sozinho é o tipo de coisa que destrói confiança no
sistema inteiro.

## Bronze — o evento traduzido

Uma linha por evento, ainda sem deduplicação e sem derivação: o mesmo que chegou no raw, com nomes e
valores no vocabulário do domínio. É o que os consumidores de negócio leem.

**atribuído** vem do envelope do raw; **origem** vem de um campo que o sistema de origem tem.

### Entrada `alert`

| Campo | Tipo | Obrigatório | Origem do valor |
|-------|------|-------------|-----------------|
| `event_id` | uuid | sim | atribuído |
| `source` | enum | sim | atribuído |
| `version` | string | sim | atribuído |
| `received_at` | timestamp | sim | atribuído |
| `external_id` | string | sim | identidade na origem |
| `opened_at` | timestamp | sim | origem |
| `acknowledged_at` | timestamp | não | origem — só quando a origem tem o campo |
| `resolved_at` | timestamp | não | origem |
| `closed_at` | timestamp | não | origem — só quando a origem tem o campo |
| `severity` | 1–5 | sim | origem |
| `status` | enum `open` / `in_progress` / `waiting` / `resolved` / `closed` / `canceled` / `unknown` | sim | origem, traduzido |
| `entity_id` | string | não | origem |
| `title` | string | sim | origem |
| `description` | string | não | origem |
| `owner` | string | não | origem — quem está com a ocorrência agora |
| `reported_by` | enum `automatic` / `manual` | não | origem, traduzido |
| `parent_id` | string | não | origem |
| `resolution_code` | string | não | origem |
| `resolution_summary` | string | não | origem |
| `labels` | mapa | não | origem |
| `source_url` | string | não | origem |

`status` cobre apenas o ciclo de vida. Reconhecimento é eixo separado, expresso por
`acknowledged_at` — um registro pode estar aberto e reconhecido, aberto e não reconhecido, ou
encerrado tendo sido ou não reconhecido antes.

O corpo original não se repete aqui: está no raw, e `event_id` liga uma linha à outra.

### Entrada `monitor`

| Campo | Tipo | Obrigatório | Origem do valor |
|-------|------|-------------|-----------------|
| `event_id` | uuid | sim | atribuído |
| `source` | enum | sim | atribuído |
| `version` | string | sim | atribuído |
| `received_at` | timestamp | sim | atribuído |
| `external_id` | string | sim | identidade na origem |
| `started_at` | timestamp | sim | origem |
| `ended_at` | timestamp | não | origem — nulo enquanto a condição persiste |
| `severity` | 1–5 | não | origem |
| `condition` | enum `firing` / `cleared` | sim | origem, traduzido |
| `entity_id` | string | sim | origem |
| `title` | string | não | origem |
| `description` | string | não | origem |
| `labels` | mapa | não | origem |
| `source_url` | string | não | origem |

`cleared` em vez de `resolved` é deliberado: `resolved` já significa outra coisa no ciclo de vida da
entrada `alert`, e o mesmo termo com dois sentidos entre as cadeias seria fonte de erro.

Sem prazo, sem responsável, sem reconhecimento: nada disso existe numa ferramenta que observa em vez
de gerenciar trabalho. `entity_id` é obrigatório aqui porque é a única chave de correlação entre as
duas cadeias.

---

## Silver — a ocorrência e a condição

Uma linha por **ocorrência**, não por evento. Cinco eventos do mesmo chamado viram um registro com o
estado dele.

Cada linha tem duas partes: os campos que vêm do bronze (o valor do evento mais recente de cada
ocorrência) e os campos derivados, que não existem em evento nenhum e só aparecem quando a sequência
é montada.

### Ocorrência — cadeia `alert`

**Do bronze, pelo evento mais recente:** `external_id`, `source`, `severity`, `status`, `entity_id`,
`title`, `description`, `owner`, `reported_by`, `parent_id`, `resolution_code`, `resolution_summary`,
`labels`, `source_url`, e os timestamps de ciclo de vida que a origem enviou.

**Derivados:**

| Campo | Como sai |
|-------|----------|
| `acknowledged_at` | primeira transição para atendimento ou primeira atribuição, quando a origem não manda |
| `closed_at` | transição para estado terminal, quando a origem não manda o timestamp |
| `duration_seconds` | do início até a resolução, ou até o encerramento quando não houve resolução |
| `deadline_seconds` | prazo da severidade **vigente** — muda quando a severidade muda |
| `due_at` | instante em que o prazo se esgota, recalculado a cada mudança de severidade |
| `consumed_ratio` | fração do prazo vigente já consumida — é ela que dispara os marcos |
| `is_eligible` | regra do domínio sobre severidade, relacionamento e estado |
| `has_breached` | duração além do prazo vigente, decidido por nós e nunca recebido |
| `severity_changes` | quantas vezes a severidade mudou, e para qual valor |

`due_at` é o campo que o acompanhador lê: saber *quando* uma ocorrência estoura é mais direto do que
recalcular a partir do prazo a cada verificação — ele ordena por `due_at` e olha só o topo da fila.

### Condição — cadeia `monitor`

**Do bronze:** `external_id`, `source`, `entity_id`, `severity`, `condition`, `title`, `labels`,
`started_at`, `ended_at`.

**Derivados:**

| Campo | Como sai |
|-------|----------|
| `is_active` | a condição ainda está disparando |
| `duration_seconds` | de `started_at` até `ended_at`, ou até agora se ainda ativa |
| `recurrence_count` | quantas vezes esta condição disparou nesta entity no período |

---

## Gold — agregações e vereditos

Aqui não se fala mais de uma ocorrência individual, e sim de conjunto. As duas cadeias produzem
coisas de natureza diferente.

### Da cadeia `monitor` — insumo de análise

Agregações por `entity`, consumidas pelos modelos e pelo contexto da análise, não por tela:

| Agregação | Conteúdo |
|-----------|----------|
| contagem por janela | quantos sinais na entity em 15min, 1h e 6h |
| taxa de auto-resolução | fração das condições que cessaram sozinhas, por entity |
| intervalo típico | tempo mediano entre sinais da entity, e a dispersão |
| sequência de severidade | progressão crescente de severidade na mesma entity |
| features diárias | volume, dispersão de entities afetadas, share por severidade |

### Da cadeia `alert` — o que o negócio consome

| Agregação | Conteúdo |
|-----------|----------|
| quebras consolidadas | por ocorrência fechada: duração, se estourou, por quanto |
| estado mensal do indicador | realizado no período e o que está em risco agora |
| tempo no primeiro atendimento | quanto ficou no grupo que recebeu primeiro, contra o prazo |
| carga por grupo | quantas ocorrências vivas por `owner` e janela |
| histórico de severidade | transições, para auditoria e para o conjunto de treino |

---

## O que deixa de ser recebido

| Campo de hoje | Passa a ser |
|---------------|-------------|
| duração | derivado no silver, do início e do fim |
| hora, dia da semana, semana, mês da abertura | derivados do início, onde forem necessários |
| rótulo textual da gravidade | derivado da severidade |
| indicador de ter relacionamento | derivado do próprio campo de relacionamento |
| elegibilidade ao indicador de negócio | derivada por regra do domínio, no silver |
| violação do prazo | derivada no cruzamento do prazo vigente, nunca recebida |

Os quatro primeiros são cálculo que hoje faz uma volta completa: são derivados fora, publicados no
payload e reextraídos do payload bruto pela camada de dados. Os dois últimos são veredito de negócio
que nenhuma origem além de um gerenciador teria.

---

## Technical Notes

**Marco de prazo, não intervalo fixo.** O marco escala com a prioridade sozinho — 25% são uma hora em
severidade 2 e três horas em severidade 3, sem tabela de configuração — e gera menos evento para
incidente longo. Medido no histórico: marcos de 25/50/75/100% produzem 22.474 eventos sobre 25.600
incidentes elegíveis, menos de um por incidente.

**O prazo só existe onde é contratual.** O acompanhamento opera sobre a entrada `alert`. A entrada
`monitor` alimenta contexto e correlação, sem relógio.

**As duas cadeias se encontram por `entity`.** É por ela que se pergunta quantos sinais estão
disparando no recurso enquanto o incidente dele está aberto sem reconhecimento.

**O prazo é derivado, e muda quando a severidade muda.** Ele não vem da origem: sai da tabela de
prazo por severidade, aplicada no estado atual. Mas severidade não é fixa — escalonamento de P3 para
P2 é operacionalmente comum, e cada mudança troca o prazo aplicável. O bronze preserva a severidade
vigente em cada evento, então o prazo de cada período é reconstruível; o estado atual carrega o
vigente agora.

Isso muda o acompanhador: numa recategorização, os marcos são **recalculados**, não continuados. Um
chamado a 50% de um prazo de 96 horas que vira severidade com prazo de 12 horas já nasce estourado no
instante da mudança, e o marco de 100% dispara ali.

**Hipótese para a divergência da apuração.** O histórico entregue traz apenas a severidade final, e
nossa régua aplica o prazo dela a toda a duração. Se a apuração da Locaweb considera o prazo vigente
em cada período, um chamado que passou quase toda a vida numa severidade branda e foi escalonado perto
do fim não violou nada — enquanto na nossa conta ele estourou dezenas de vezes. Isso encaixa com o
padrão medido, em que quanto mais o chamado "estoura", menos ele é contado, e explica por que nenhuma
hipótese de fórmula com prazo único funcionou. **Só é testável com o histórico de mudanças de
severidade**, que o export atual não traz — e que a ingestão por transição passa a fornecer.

**A armadilha do treino.** Dataset de treino que sai do estado atual vaza futuro, porque o estado
atual guarda o desfecho. Cada marco emitido é uma linha de treino com o que se sabia naquele
instante; a unidade passa a ser (incidente × marco).

**A origem precisa disparar em cada transição, não só na abertura e no fechamento.** É a
dependência mais crítica desta track e não é sobre campo, é sobre gatilho. Nos dois gerenciadores o
webhook é configurável por evento: no ServiceNow a regra de negócio escolhe entre inserção,
atualização ou transições específicas; no Jira a automação dispara em criação, transição de status ou
mudança de campo. Configurado só para inserção e fechamento, não existe sequência de onde derivar o
momento em que alguém assumiu, e o eixo de reconhecimento deixa de existir. **Pergunta a confirmar
com a Locaweb antes de a fase de ingestão começar.**

**Como a apuração de violação funciona lá continua desconhecido.** O que a análise do histórico
mostrou: violação de prazo não é fórmula, é decisão posterior — entre os que estouraram, apenas 6,8%
contaram, e quanto mais o chamado estoura, menos chance de contar. A hipótese é que a apuração separa
falha de operação de chamado esquecido, mas não foi confirmada. **Segunda pergunta a levar para
eles**, porque se houver desconto de tempo em pausa, o histórico de transições resolveria e mudaria o
que dá para prever.

**Prazo de severidade 4 é 24 horas** (decisão do usuário, 2026-08-19) — o dicionário de dados e o
código estão certos; o material de kickoff registra 96 horas e é o que diverge. Sem efeito em dado
hoje, porque o cálculo de tempo no primeiro atendimento filtra por elegibilidade ao indicador e
severidade 4 nunca entra. Vale confirmar com a Locaweb junto das outras perguntas, porque esta track
passa a derivar a elegibilidade e o valor deixa de ser inócuo.

**O simulador precisa emitir ciclo de vida.** Hoje ele publica o incidente já fechado, com duração
preenchida — não existe "continua aberto" para reavaliar. O histórico tem os três instantes
(abertura, resolução, encerramento) necessários para decompor.

---

_Generated by Conductor. Review and edit as needed._
