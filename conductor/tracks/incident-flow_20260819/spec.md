# Specification: Fluxo do incidente — duas entradas, marcos de prazo e read model

**Track ID:** incident-flow_20260819
**Type:** Feature
**Created:** 2026-08-19
**Status:** Complete

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

- [x] Uma origem do tipo `alert` e uma do tipo `monitor` entregam no mesmo gateway, cada uma pelo seu
      contrato, sem campo vazio carregando semântica
- [x] Um incidente aberto gera marcos aos 25%, 50%, 75% e 100% do prazo da sua prioridade
- [x] O marco de 100% constata o estouro; nenhum marco de prazo é emitido depois dele
- [x] O fechamento do incidente consolida a quebra — duração, se estourou e por quanto
- [x] O vocabulário do domínio distingue o que vem de cada natureza de origem, sem termo herdado de
      quando existia uma só
- [x] Os marts continuam produzindo os mesmos números depois de mudarem de cadeia
- [x] O corpo da origem é gravado antes de qualquer interpretação, e um recorte por origem e período
      é lido sem abrir o corpo
- [x] Corrigir o dicionário e reprocessar um período produz resultado novo sem perder o anterior
- [x] Nenhum consumidor de negócio precisa conhecer vocabulário de origem

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
| `tenant_id` | string | atribuído — pela credencial |
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
| `tenant_id` | string | sim | atribuído — pela credencial |
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
| `tenant_id` | string | sim | atribuído — pela credencial |
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

A identidade de uma ocorrência é `(tenant_id, source, external_id)` — o identificador da origem só é
único dentro de uma origem de um tenant.

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
| estado mensal do indicador | realizado no período e o que está em risco agora, honesto por severity — não avalia meta, só conta (a meta é a linha de baixo) |
| atingimento anual do KPI | quebras acumuladas no ano contra a banda de % de atingimento da severidade, por tenant |
| tempo no primeiro atendimento | quanto ficou no grupo que recebeu primeiro, contra o prazo |
| carga por grupo | quantas ocorrências vivas por `owner` e janela |
| histórico de severidade | transições, para auditoria e para o conjunto de treino |
| tendência por categoria/produto | volume diário por categoria e produto — o desafio pede tendência "agrupada por categoria, produto ou item de configuração"; item de configuração já é `entity_id` em todo o resto desta seção |
| cruzamento categoria/produto/entity/severity | mesma coisa, sem colapsar nenhuma dimensão — insumo de clusterização e causa recorrente, não leitura direta |
| sequências de sem-intervenção por entity | falhas consecutivas com `resolution_code = no_intervention` na mesma entity — o sinal preditivo de queda iminente que o kickoff da Locaweb descreve (§4, "Gatilhamento Preditivo"), nunca severity isolada |
| features diárias | volume e composição por severidade — insumo do modelo de volume, não produto de tela; a cadeia `monitor` tem a sua própria (linha acima), para o detector de evento externo — as duas não se misturam |

`gold_alert_daily_features`, uma linha por `date` × `source`:

| Campo | Como sai |
|-------|----------|
| `date` | `toDate(opened_at)` |
| `source` | do bronze |
| `total_incidents` | contagem de ocorrências abertas no dia |
| `p1_count` … `p5_count` | contagem por severidade, as cinco — volume é sobre o que exige trabalho, não só o que entra no indicador |
| `p1_share` | fração severidade 1 sobre o total |
| `critical_share` | fração severidade 1–2 sobre o total |
| `unique_entities` | entities distintas no dia |
| `incidents_per_entity` | `total_incidents / unique_entities` |
| `standalone_count` / `standalone_share` | sem `parent_id` — contagem e fração |
| `manual_open_share` | fração `reported_by = manual` |
| `no_intervention_share` | fração `resolution_code = no_intervention` |
| `avg_opened_hour` | hora média de abertura, calculada aqui — não é campo recebido nem armazenado |
| `avg_duration_seconds` / `median_duration_seconds` / `p95_duration_seconds` | estatísticas de `duration_seconds` no dia |

Deliberadamente **sem** `in_kpi`/`breached`/`breach_rate`: neste grão (`date` × `source`, sem
`severity`) essa fração misturaria severidades com meta diferente numa razão só que não corresponde
a nenhuma meta real — `kpi_monthly_state`, que já agrupa por `severity`, é o lugar correto para essa
leitura, e a leitura contra a meta em si é `gold_alert_kpi_achievement`, abaixo.

### A meta do KPI é configuração por tenant

`docs/context/data-dictionary.md` §"Metas Anuais de KPI" é quem se declara autoridade sobre o
significado do dado (linha 6: "É a autoridade sobre o que cada dado significa") — é essa tabela que
vale, não o resumo da ata do kickoff (`docs/context/kickoff-challenge-locaweb.md` §3, que fala em
"teto mensal combinado P1+P2", uma estrutura diferente). A meta real é **anual, cumulativa,
avaliada mês a mês contra o total do ano até ali**, em banda de percentual de atingimento — mas só
existe, documentada, para severity 2 e 3.

**Severity 1 não é avaliada sozinha — entra somada com severity 2.** O kickoff nunca fala de P1
isolado, sempre "P1+P2": a mesma meta serve para as duas juntas, não uma meta por severity. E a
banda de 100% de severity 2 sozinha (36-39 quebras/ano) dividida por 12 dá ~3/mês — exatamente o
"Máximo 3 (P1+P2)" do kickoff. As duas coisas batem: P1+P2 combinados são avaliados contra a mesma
banda que hoje só está documentada em nome de severity 2, e severity 3 é avaliada separada, com
banda própria. Decisão do usuário, 2026-08-20: `tenant_kpi_targets` é indexada por um agrupamento
(`kpi_group`), não por `severity` sozinha — `p1_p2` (severity 1 e 2 somadas) e `p3` (severity 3
sozinha) — não uma linha de banda por severity individual.

`tenant_kpi_targets` (seed, mesmo padrão de `tenant_deadlines`): cada linha é uma faixa da banda.

| Campo | Como sai |
|-------|----------|
| `tenant_id` | — |
| `kpi_group` | `p1_p2` ou `p3` — nunca `severity` sozinha, porque a meta de P1+P2 é combinada |
| `max_breaches` | teto de quebras no ano para esta faixa alcançar `achievement_pct` |
| `achievement_pct` | percentual de atingimento da faixa |

Locaweb, extraído de `data-dictionary.md` (a banda de `p1_p2` é a que hoje está documentada só em
nome de severity 2 — não há banda própria de severity 1 isolada, e o padrão "sempre P1+P2 junto" do
kickoff é o que justifica reaproveitá-la para o grupo):

| kpi_group | max_breaches | achievement_pct |
|-----------|--------------|------------------|
| p1_p2 | 30 | 150 |
| p1_p2 | 35 | 125 |
| p1_p2 | 39 | 100 |
| p1_p2 | 45 | 75 |
| p1_p2 | 53 | 50 |
| p1_p2 | 999999 | 0 |
| p3 | 200 | 150 |
| p3 | 230 | 125 |
| p3 | 263 | 100 |
| p3 | 290 | 75 |
| p3 | 320 | 50 |
| p3 | 999999 | 0 |

`999999` no lugar de um `max_breaches` nulo/infinito — mesma razão de `tenant_deadlines` nunca usar
`NULL` para "sem limite": a faixa de 0% precisa de uma linha explícita e comparável, não um caso
especial na consulta.

`gold_alert_kpi_achievement`, uma linha por `tenant_id` × `year` × `month` × `kpi_group`
(`severity in (1,2)` vira `p1_p2`, somadas; `severity = 3` vira `p3`; 4/5 seguem fora do KPI):

| Campo | Como sai |
|-------|----------|
| `tenant_id` | — |
| `year` | `toYear(opened_at)` |
| `month` | `toStartOfMonth(opened_at)` |
| `kpi_group` | `multiIf(severity in (1,2), 'p1_p2', severity = 3, 'p3', null)` |
| `breached_in_month` | quebras daquele mês, somadas dentro do grupo, só entre os `is_eligible` — sem isso um incidente com `parent_id` preenchido ou `resolution_code = no_intervention` contaria pra meta que a regra do KPI diz que ele nem participa |
| `breached_ytd` | soma cumulativa de `breached_in_month` no ano, até este mês — é contra ela que a banda é lida |
| `achievement_pct` | faixa de `tenant_kpi_targets` cujo `max_breaches` é o menor que ainda cobre `breached_ytd`, pelo `kpi_group` |

É esta mart, não `kpi_monthly_state`, que responde à user story do gestor ("quero ver a projeção de
fechamento dos KPIs do mês") — a projeção só faz sentido contra a meta anual cumulativa, não contra
um mês isolado.

`no_intervention_sequences_by_ci`, uma linha por sequência consecutiva — mesma técnica de
islands-and-gaps que a antiga `p4_sequences_by_ci` usava, mas o critério vem de `resolution_code`
(campo que o domínio já define com esse sentido em `silver_alert`), não de `severity`, que é um
passthrough sem relação com o sinal que o kickoff descreve:

| Campo | Como sai |
|-------|----------|
| `entity_id` | do silver |
| `sequence_group` | agrupador da sequência (islands-and-gaps), não tem sentido de negócio isolado |
| `sequence_start` / `sequence_end` | `min`/`max(opened_at)` da sequência |
| `sequence_length` | quantas ocorrências seguidas |
| `first_incident` / `last_incident` | `external_id` do primeiro e do último da sequência |

Filtro: `resolution_code = 'no_intervention'`, ordenado por `entity_id, opened_at`, mesma técnica de
`row_number() - row_number()` particionado por `entity_id`.

### Categoria e produto — presentes desde o bronze, sem gold até agora

`category`/`product`/`subcategory` sobrevivem à tradução (`apps/data-ingest/src/sources/itsm.py`),
mas vivem dentro de `labels` (mapa livre) — nenhuma gold lê `labels` hoje. O desafio pede
explicitamente tendência "agrupada por categoria, produto ou item de configuração" e "quais
produtos ou categorias exigem atenção", com P2 e P3 obrigatórias — sem extrair essas duas chaves de
`labels`, essa parte do desafio não tem onde se apoiar.

`gold_alert_category_trends` — leve, uma linha por `date` × `category` × `product`, para leitura
direta de tendência:

| Campo | Como sai |
|-------|----------|
| `date` | `toDate(opened_at)` |
| `category` | `labels['category']`, `''` quando ausente — não filtrado, fica visível como categoria vazia |
| `product` | `labels['product']`, mesma regra |
| `total_incidents` | contagem no dia |
| `p1_count` … `p5_count` | contagem por severidade — P2/P3 sempre presentes, nunca colapsados |
| `avg_duration_seconds` | média de `duration_seconds` no dia |

`gold_alert_category_entity_breakdown` — pesado, uma linha por `date` × `category` × `product` ×
`entity_id` × `severity`, sem colapsar nenhuma dimensão — insumo de clusterização e causa
recorrente (desafio: "classificação ou clusterização... agrupar causas recorrentes"), não produto
de tela:

| Campo | Como sai |
|-------|----------|
| `date` | `toDate(opened_at)` |
| `category` / `product` | mesma extração de `labels` |
| `entity_id` | do silver — o "item de configuração" |
| `severity` | — |
| `incident_count` | contagem da combinação no dia |
| `breached` | `countIf(has_breached)` — seguro aqui porque `severity` já é grão, não mistura metas |
| `avg_duration_seconds` | média de `duration_seconds` da combinação |

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

---

## Onde cada camada mora e como particiona

| Camada | Onde | Por quê |
|--------|------|---------|
| Raw | lake, em arquivo colunar | é arquivo de arquivo: existe para reprocessar e auditar, raramente é lido |
| Bronze | warehouse | consultável, alimenta o silver, é o que os consumidores leem |
| Silver, Gold | warehouse | derivados do bronze |

O corpo cru não é materializado no warehouse e o traduzido não vai para o lake — cada evento existe
duas vezes, em formas com função distinta. Reprocessar lê o arquivo direto, sem precisar do corpo
materializado no warehouse.

**Raw**, particionado no caminho: `tenant / entrada / origem / data de recepção`. Por recepção e não
pela data do evento, porque reprocessar é sempre "reler o que chegou entre tal e tal dia", e escrever
por data de recepção mantém a gravação sequencial. Um evento antigo que chegue hoje por reenvio cai
na pasta de hoje, que é onde alguém vai procurá-lo.

**Bronze**, partição mensal por recepção, ordenado por `(tenant_id, source, external_id, received_at)`.
Mensal porque partição diária multiplica partes e degrada o merge. A ordenação é o que torna barata a
consulta que mais importa aqui — *todos os eventos desta ocorrência, em ordem* — que é o que o silver
faz para montar o estado.

**Silver**, partição mensal pela abertura, ordenado por `(tenant_id, source, external_id)`. Muda a
chave porque muda a pergunta: aqui a linha representa a vida da ocorrência, e as consultas são por
período de abertura.

**Gold**, ordenado pela dimensão que a agregação usa — entity e janela, período e severidade, ou
responsável e janela.

A consulta do acompanhador é "abertas, ordenadas por `due_at`", e `due_at` não serve como chave
primária: ele é reescrito a cada recategorização. Como o conjunto de ocorrências vivas é pequeno,
isso se resolve com uma visão só dos abertos, sem forçar a ordenação da tabela inteira.

---

## Treino revisto

O `ml-trainer` de hoje (`apps/ml-trainer/src/breach/`, `volume/`, `external_event/`) foi construído
antes desta track, sobre os marts antigos. Esta seção documenta como cada um muda — não é aspiracional,
é o que a Fase 8 constrói, sobre a mart `breach_training_examples` que a Fase 7 já deixou pronta.

### A unidade: (incidente × marco)

Cada mensagem em `deadlines.milestone` (Fase 6) vira uma linha de treino, materializada por
`breach_training_examples` (Fase 7, `apps/data-runner/models/marts/breach_training_examples.sql`) —
mesma técnica do macro `silver_alert_as_of` (`received_at <= cutoff`), aplicada por marco em vez de
"agora". Nenhuma feature de treino lê `silver_alert`/`silver_alert_open` diretamente, porque essas
tabelas guardam o estado **atual**, que vaza o desfecho — as únicas colunas dessa mart que vêm do
estado atual são `has_breached`/`final_consumed_ratio`/`final_duration_seconds` (o rótulo e os
critérios de exclusão abaixo, deliberadamente).

Um incidente que cruza três marcos gera três linhas, cada uma com o que se sabia até ali — não é o
mesmo incidente contado três vezes, é três instantes de decisão diferentes.

### Rótulo: `has_breached`, não `kpi_breached`

Decisão do usuário, 2026-08-20: o rótulo passa a ser o fato técnico (`has_breached` no instante do
marco), não a violação apurada da Locaweb. `docs/insights/fluxo-do-incidente.md` mede os dois —
0,97% positivos pra apuração, 14,2% pra estouro bruto — e mostra que a apuração é **julgamento
humano/de negócio calibrado pra fechar a aritmética da meta anual** (a mesma banda de
`tenant_kpi_targets`), não uma regra técnica sobre o incidente: quanto mais um incidente estoura,
menos chance de ser contado (33,3% contado entre 1×-1,5× o prazo, 1,6% acima de 50×) — o oposto do
que se esperaria de uma regra de negócio simples. O critério exato nunca foi confirmado com a
Locaweb (pendência já registrada em `fluxo-do-incidente.md`); treinar contra ele é treinar contra um
processo não documentado.

### Exclusões do conjunto de treino

- **`is_eligible`** no instante do marco — severity 1-3, sem `parent_id`, `resolution_code` diferente
  de `no_intervention`. Herdado de `silver_alert_as_of`, não recalculado.
- **Abandono**: `consumed_ratio >= 10.0` — teto medido em `fluxo-do-incidente.md` (2.499 incidentes
  históricos além de dez vezes o prazo, extremo em 2.044×), "que não são casos que a operação
  poderia ter salvo". Mesmo valor do `abandoned_ratio` do acompanhador de prazo (Fase 6) — ver nota
  abaixo, o valor de lá estava errado e este spec corrige os dois juntos.
- **Ruído de rede**: `duration_seconds < noise_threshold`, onde `noise_threshold = greatest(60,
  percentile(0.01)(duration_seconds))` sobre o histórico elegível — kickoff §5 ("incidentes de
  duração ínfima, ex: 14 segundos, são ruído de rede"). Sem número exato documentado; decisão do
  usuário, 2026-08-20: percentil 1 com piso de 60s, não um número fixo sozinho, pra se adaptar à
  distribuição real sem cair abaixo de um mínimo defensável.

### `abandoned_ratio` do acompanhador de prazo estava errado

`apps/data-deadline-tracker/src/settings.py` usa `abandoned_ratio: float = 3.0` (Fase 6) — inventado
sem checar `fluxo-do-incidente.md`, que já tinha a análise pronta. Corrige para **10.0**, mesmo valor
usado para excluir abandono do treino acima. Ambos os lugares precisam do mesmo número: o
acompanhador decide quando avisar que um incidente foi abandonado, o treino decide quando parar de
tratar um incidente como recuperável — é o mesmo limiar, medido uma vez.

### Features — o que sobrevive, o que muda de fonte, o que é novo

Todas calculadas **no instante do marco**, nunca sobre o estado atual:

| Feature hoje (`breach/features.py`) | O que muda |
|--------------------------------------|------------|
| `severity` | sobrevive — severity vigente no instante do marco |
| `opened_hour`, `opened_dayofweek` | sobrevive — de `opened_at`, fixo por incidente |
| `is_manual_open` | sobrevive — `reported_by = 'manual'` |
| `assignment_group` | renomeia para `owner`, mesmo campo |
| `p4_precursor_present`/`_length` | corrige a mesma confusão da Fase 5 — o sinal do kickoff é `resolution_code = no_intervention`, não severity 4; usa `no_intervention_sequences_by_ci` reconstruído até o instante do marco, não `severity = 4` |
| `no_intervention_count_1h`/`_6h` | sobrevive na ideia, mas a contagem tem que ser reconstruída ponto-no-tempo (bucket anterior ao marco), não lida de `incidents_by_ic` (que é histórico completo, não point-in-time) |
| `group_load_1h` | **não dá mais pra ler de `group_load_by_window`** — essa mart virou snapshot do "agora" na Fase 5 (5.4, "contando o que está vivo"), não série histórica. Recalculada dentro da própria montagem do dataset: quantos outros incidentes do mesmo `owner` estavam abertos (`opened_at <= marco.occurred_at` e ainda não fechados naquele instante), a partir do bronze |
| `was_recategorized`/`recategorization_count` | sobrevive, mas passa a vir de `severity_changes` do `silver_alert_as_of(cutoff)` em vez de recontar `priority_changes_log` à mão — o macro já reconstrói isso corretamente pro instante |
| `group_severity_historical_ola_ratio`/`_over_25pct_rate` | sobrevive na ideia (histórico expansivo, sem vazamento) — recalculada sobre incidentes anteriores ao marco, não ao "agora" |

Novas, da Fase 3 (marco) e Fase 4 (gold `monitor`, por `entity` — task 8.2):

| Feature | De onde |
|---------|---------|
| `consumed_ratio` | do próprio marco |
| `time_remaining_seconds` | `due_at - occurred_at` do marco |
| `was_acknowledged` | `acknowledged_at is not null` no instante do marco |
| `entity_signal_count_15m`/`_1h` | `gold_monitor_signal_counts`, janela mais próxima anterior a `occurred_at` |
| `entity_auto_resolution_rate` | `gold_monitor_auto_resolution_rate` |
| `entity_severity_escalations` | `gold_monitor_severity_escalations`, acumulado até `occurred_at` |

### Volume (`gold_alert_daily_features`, task 8.6)

Fonte muda de `daily_anomaly_features` (removida na Fase 5) para `gold_alert_daily_features` —
`total_incidents`/`p1_count`…`p5_count` no lugar de `total_incidents`/`p1_count`/`p2_count`/
`p3_count`. Formato longo por `priority_group` (`total`/`p1`/`p2`/`p3`), lags, rolling, Fourier,
feriado — mesmo desenho de hoje, D+1 e D+7 mantidos. `avg_opened_hour` sobrevive (já existe em
`gold_alert_daily_features`).

### Detector de evento externo (`external_event`) — sem task até agora

Descoberto ao escrever esta seção: `external_event/data.py` também lê a extinta
`daily_anomaly_features`, e a Fase 4/5 já decidiu que esse detector migra inteiro para
`gold_monitor_daily_features` (cadeia `monitor`) — mas nenhuma task cobria atualizar o treino em si.
Adicionada como 8.9.

### Serving

`apps/ml-model-serving/src/schemas.py` espelha `FEATURE_COLUMNS` campo a campo com
`extra="forbid"` — qualquer mudança acima quebra o schema Pydantic de `/predict/breach` até ser
atualizado. Task 8.7 cobre os dois lados juntos, não só o trainer.

## Technical Notes

**Marco de prazo, não intervalo fixo.** O marco escala com a prioridade sozinho — 25% são uma hora em
severidade 2 e três horas em severidade 3, sem tabela de configuração — e gera menos evento para
incidente longo. Medido no histórico: marcos de 25/50/75/100% produzem 22.474 eventos sobre 25.600
incidentes elegíveis, menos de um por incidente.

**O prazo só existe onde é contratual.** O acompanhamento opera sobre a entrada `alert`. A entrada
`monitor` alimenta contexto e correlação, sem relógio.

**As duas cadeias se encontram por `entity`.** É por ela que se pergunta quantos sinais estão
disparando no recurso enquanto o incidente dele está aberto sem reconhecimento.

**Multi-tenant desde o começo.** `tenant_id` é atribuído pela credencial, nunca lido do corpo, e
prefixa a chave de ordenação em todas as camadas. Duas consequências: a tabela de prazo por
severidade deixa de ser constante no código e vira configuração por tenant, porque o prazo é contrato
de cada cliente; e o dicionário de tradução passa a ser indexado por tenant e origem, porque dois
clientes com o mesmo sistema podem ter estados customizados diferentes.

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

**A meta de erro do KPI não tem banda documentada por severity individual para P1.**
`data-dictionary.md` §"Metas Anuais de KPI" só define banda de atingimento para P2 e P3 — nenhuma
linha para P1 sozinha, e a estrutura ali (banda anual cumulativa de % de atingimento) diverge do
resumo do kickoff ("teto mensal combinado P1+P2"). `tenant_kpi_targets` resolve isso combinando P1 e
P2 num `kpi_group` só (`p1_p2`), avaliados contra a banda hoje documentada em nome de severity 2 —
o kickoff nunca fala de P1 isolado, sempre "P1+P2", e a banda de 100% de P2 (36-39/ano) dividida por
12 bate com o "Máximo 3" do kickoff. Aproximação declarada, não confirmada — terceira pergunta a
levar para a Locaweb, mesma natureza da divergência do prazo de P4.

---

_Generated by Conductor. Review and edit as needed._
