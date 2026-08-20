# Implementation Plan: Fluxo do incidente — duas entradas, marcos de prazo e read model

**Track ID:** incident-flow_20260819
**Spec:** [spec.md](./spec.md)
**Created:** 2026-08-19
**Status:** [ ] Not Started

## Overview

Sete fases. O vocabulário e os contratos vêm primeiro porque tudo depois deles carrega os nomes que
eles definem. Em seguida as camadas são construídas de baixo para cima e por cadeia — bronze,
estado atual, e os dois golds, que têm finalidades diferentes. O acompanhador de prazo vem quando já
existe estado de onde ler. Os treinos fecham, porque a unidade de exemplo muda e isso só faz sentido
depois que os marcos existem.

Não é reorganização de tabela: os marts mudam de chave, de coluna e de significado, e os modelos
mudam de fonte e de unidade de treino. Nenhum sobrevive à separação sem revisão.

A interface e o que ela consome ficam na track do front, criada depois desta.

---

## Phase 1: Vocabulário e contratos

Os nomes definidos aqui vão para contrato publicado, tópico, tabela e coluna. Escrever contrato antes
de fechar vocabulário é decidir o nome duas vezes.

### Tasks

- [x] 1.1: Rever o termo que hoje descreve o que trafega — cunhado quando existia uma origem só — e
      nomear o que cada natureza emite
- [x] 1.2: Registrar os termos no vocabulário do domínio, com o que deixa de ser usado
- [x] 1.3: Contrato da entrada `alert`: identidade, início, fim, gravidade, entidade, ciclo de vida,
      reconhecimento, título, responsável, relacionamento, link
- [x] 1.4: Contrato da entrada `monitor`: identidade, início, fim, gravidade, entidade, condição,
      título, classificação, link
- [x] 1.5: Reconhecimento humano como eixo separado do ciclo de vida na entrada `alert`
- [x] 1.6: Campos que hoje só existem no payload bruto e são universais entram no contrato
- [x] 1.7: Veredito de negócio deixa de ser recebido da origem e passa a ser derivado
- [x] 1.8: Versão no contrato publicado de cada entrada, para o consumidor saber o que está lendo e
      para duas versões coexistirem durante uma transição
- [x] 1.9: `source` e `tenant_id` saem do contrato de entrada — nenhum dos dois é declarado pela
      origem, os dois vêm da credencial
- [x] 1.10: `tenant_id` no envelope e nos dois contratos traduzidos, prefixando a identidade da
      ocorrência: o identificador da origem só é único dentro de uma origem de um tenant
- [x] 1.11: Dicionário de tradução indexado por tenant e origem — dois tenants no mesmo sistema podem
      customizar estados diferentes
- [x] 1.12: Formato do dicionário de tradução: como uma origem declara seus valores e como a versão
      do dicionário fica registrada no resultado

### Verification

- [x] Nenhum consumidor precisa abrir payload bruto para obter campo universal
- [x] Os dois contratos publicados não têm campo que só faz sentido para uma das naturezas

---

## Phase 2: Ingestão, bronze e tradução

O gateway autentica e guarda; a tradução é estágio próprio. Cada transição da origem chega como
mensagem, não como atualização de um registro consolidado no fim.

### Tasks

**Recepção**

- [x] 2.1: Rota de entrada por origem, versionada, com a credencial da integração vinculada a ela
- [x] 2.2: Envelope atribuído pelo gateway: identidade do evento, origem, entrada, versão do
      formato e instante de recepção — nada lido do corpo
- [x] 2.3: Publicação no tópico cru correspondente à natureza da origem
- [x] 2.4: Métricas por origem e por natureza

**Bronze**

- [x] 2.5: Raw no lake, em arquivo colunar particionado por tenant, entrada, origem e data de
      recepção, com o corpo como coluna de texto — o corpo cru não é materializado no warehouse
- [x] 2.6: Tabelas de bronze no warehouse, append-only por entrada, sem o corpo: partição mensal por
      recepção e ordenação por `(tenant_id, source, external_id, received_at)`
- [x] 2.7: Leitura do raw pelo warehouse para reprocessamento, sem materializar — implementado como
      leitor Python (`reprocess.py`) sobre os objetos do lake, não como função `S3`/tabela nativa do
      ClickHouse; atinge o mesmo objetivo (reprocessar sem materializar o raw no warehouse), mas vale
      revisar se uma tabela `S3` do ClickHouse serve melhor quando o volume justificar
- [x] 2.8: Destino do tópico atual: `incidents.received` é descontinuado — sem alias, sem preservar
      o dado antigo (decisão do usuário, 2026-08-19: as tabelas e tópicos de hoje viram lixo assim
      que as novas existirem, nada a migrar)

**Corte de `incidents.received`**

Descoberto ao planejar o corte: o plan.md original só cobria a migração do `data-ingest`, mas dois
outros consumidores leem de `incidents.received`/`incidents_received` hoje e ficariam quebrados sem
tarefa própria — corrigido aqui antes da Fase 2 começar a implementar.

- [x] 2.7.1: Migrar `ml-burst-detector` para consumir `events.monitor` — a natureza dele é
      monitoração por entity (z-score/CUSUM sobre sinal), não gestão de ocorrência
- [x] 2.7.2: Migrar `stg_incidents.sql` (data-runner) para a fonte traduzida da cadeia `alert` — os
      sete marts que dependem dele (`incidents_by_ic`, `p4_sequences_by_ci`,
      `daily_anomaly_features`, `first_touch_duration`, `group_load_by_window`,
      `kpi_monthly_state`, `priority_changes_log`) ficam quebrados até serem reconstruídos por cadeia
      nas Fases 3–5 — consequência aceita do corte duro, não um bug desta task
- [x] 2.7.3: Descontinuar a tabela `incidents_received` do ClickHouse e o tópico `incidents.received`
      do chart `data-kafka` — nenhum consumidor aponta mais para eles

**Tradução**

- [x] 2.9: Estágio de tradução como componente próprio, consumindo o tópico cru — vive dentro do
      `data-ingest` existente, não em app novo (decisão do usuário, 2026-08-19)
- [x] 2.10: Dicionário por tenant e origem fora do código, versionado — ciclo de vida, condição e o que
      originou o registro, mapeados no vocabulário do domínio
- [x] 2.11: Valor fora do dicionário vira o caso desconhecido e fica visível, sem falhar o evento
- [x] 2.12: Publicação no tópico traduzido, que é o que os consumidores de negócio leem
- [x] 2.13: Reprocessamento de um período com uma versão de dicionário, sem sobrescrever o resultado
      anterior
- [x] 2.14: `ScaledObject` para os consumidores da ingestão e da tradução — dois triggers Kafka (um
      por tópico cru) no mesmo `ScaledObject`, já que ingestão e tradução são o mesmo consumidor

**Testes**

- [x] 2.15: Tradução por origem, incluindo valor fora do dicionário
- [x] 2.16: Payload que tenta declarar a própria origem não influencia o envelope
- [x] 2.17: Reprocessamento produz resultado determinístico para uma dada versão de dicionário

### Verification

- [x] O corpo é gravado antes de qualquer interpretação
- [x] Nenhum consumidor de negócio lê o tópico cru
- [x] Uma transição de estado chega como mensagem própria, não como atualização do mesmo registro
- [x] Corrigir o dicionário e reprocessar um período gera resultado novo sem perder o anterior
- [x] Origem nova não altera contrato traduzido nem consumidor
- [x] Nada no repositório aponta mais para `incidents.received` ou `incidents_received` (fora de
      migrations históricas e docs de tracks já fechadas, que registram o que era verdade então)

---

## Phase 3: Estado atual por cadeia

Com stream, contar linha de bronze passa a contar evento, não ocorrência.

### Tasks

- [x] 3.1: Estado atual da cadeia `alert`: última versão por `(tenant_id, source, external_id)`, com
      deduplicação, partição mensal pela abertura
- [x] 3.2: Visão dos abertos ordenada por prazo a vencer, separada da tabela cheia
- [x] 3.3: Estado atual da cadeia `monitor`: quais condições estão ativas por entity
- [x] 3.4: Campos derivados calculados aqui, não recebidos: duração, elegibilidade, consumo de prazo
- [x] 3.5: Tabela de prazo por severidade como configuração por tenant, não constante no código
- [x] 3.6: Reconstrução do estado em um instante passado a partir do bronze
- [x] 3.7: Testes de que a deduplicação não multiplica contagem

### Verification

- [x] Contagens coerentes com número de ocorrências, não de eventos
- [x] O estado em um instante passado pode ser reconstruído sem depender do estado atual

---

## Phase 4: Gold da cadeia `monitor`

Agregações por entity. Insumo de análise, não produto de tela.

### Tasks

- [x] 4.1: Contagem por entity e janela, sobre a nova chave e a nova fonte
- [x] 4.2: Taxa de auto-resolução por entity
- [x] 4.3: Intervalo típico entre sinais por entity
- [x] 4.4: Sequência de severidade crescente por entity
- [x] 4.5: Agregações diárias para o detector de evento externo
- [x] 4.6: Snapshot em cache do que o caminho de inferência consome
- [x] 4.7: Testes de cada agregação e do snapshot

### Verification

- [x] As agregações existem para entity sem nenhuma ocorrência aberta
- [x] Os números batem com a contagem direta no bronze da cadeia

---

## Phase 5: Gold da cadeia `alert`

O que o negócio consome: prazo, responsável, desfecho.

`incidents_by_ic` e `p4_sequences_by_ci` não tinham task própria nem linha na tabela de gold do
spec — descoberto ao implementar que o `ml-trainer` (breach-risk) ainda lê as duas. Decisão do
usuário, 2026-08-20: reconstruir as duas sobre `silver_alert` mesmo assim, para não quebrar o
breach-risk além do que a Fase 7 já vai mexer. `daily_anomaly_features` (cadeia `alert`) não ganha
reconstrução — o detector de evento externo migra inteiro para `gold_monitor_daily_features`
(Fase 4); `ml-trainer.volume`, que lia a versão `alert`, fica quebrado até a Fase 7 (`7.6: Modelo de
volume revisto`) decidir sua nova fonte.

`p4_sequences_by_ci` reconstruída sobre `silver_alert` (5.7 abaixo) manteve o filtro `severity = 4`
da mart antiga sem questionar — descoberto ao revisar contra
`docs/context/kickoff-challenge-locaweb.md` §4 ("Gatilhamento Preditivo") que o sinal preditivo real
é sequência de `resolution_code = no_intervention`, campo que `silver_alert` já define com esse
sentido; `severity` é só passthrough, sem relação com o sinal. Corrigida e renomeada para
`no_intervention_sequences_by_ci`. `gold_alert_daily_features` (7.9) teve o mesmo problema por trás:
`in_kpi`/`breached`/`breach_rate` num grão sem `severity` misturava severidades com meta diferente
numa razão só. A meta em si acabou virando trabalho desta fase (5.9/5.10 abaixo) — não é config que
cabe fora desta track, como cheguei a registrar antes: `docs/context/data-dictionary.md` §"Metas
Anuais de KPI" tem a banda real (anual, por severity 2 e 3, com % de atingimento), diferente do
resumo do kickoff; ver spec.md, seção Gold da cadeia `alert`, e Technical Notes sobre a divergência.

Faltando implementar ainda: 5.9-5.12 abaixo, descobertas ao conferir a gold inteira contra o
enunciado oficial do desafio (categoria/produto sobrevivem no bronze dentro de `labels`, mas nenhuma
gold lia — o desafio pede tendência agrupada por categoria/produto explicitamente).

### Tasks

- [x] 5.1: Consolidação de quebra por ocorrência fechada — duração, se estourou e por quanto
- [x] 5.2: Estado mensal do KPI, com realizado e com o que está em risco
- [x] 5.3: Tempo no primeiro grupo de atendimento, sobre a nova chave
- [x] 5.4: Carga por grupo e janela, contando o que está vivo
- [x] 5.5: Histórico de mudança de gravidade
- [x] 5.6: Contagem de incidentes por entity e janela, sobre `silver_alert` (`incidents_by_ic`)
- [x] 5.7: Sequências consecutivas de `resolution_code = no_intervention` por entity, sobre
      `silver_alert` (`no_intervention_sequences_by_ci`, renomeada de `p4_sequences_by_ci`)
- [x] 5.8: Testes de cada mart e das regras derivadas; remover `daily_anomaly_features` (cadeia
      `alert`) e `stg_incidents`, órfãos após o corte
- [x] 5.9: `tenant_kpi_targets` (seed) — banda de atingimento anual por tenant e severity, mesmo
      padrão de `tenant_deadlines`
- [x] 5.10: `gold_alert_kpi_achievement` — quebras acumuladas no ano contra a banda, só severity
      elegível
- [x] 5.11: `gold_alert_category_trends` — volume diário por categoria e produto, extraídos de
      `labels`
- [x] 5.12: `gold_alert_category_entity_breakdown` — cruzamento categoria × produto × entity ×
      severity, sem colapsar dimensão, insumo de clusterização

### Verification

- [x] Nenhum mart depende de veredito recebido da origem
- [x] Os números continuam coerentes com o histórico conhecido

---

## Phase 6: Acompanhador de prazo

A peça que reage à passagem do tempo, não a evento de origem.

### Tasks

- [x] 6.1: Serviço que mantém o conjunto de ocorrências abertas, reconstruível do bronze
- [x] 6.2: Cálculo do instante em que cada aberta cruza 25%, 50%, 75% e 100% do prazo
- [x] 6.3: Emissão do marco com o que se sabia naquele instante
- [x] 6.4: Nenhum marco de prazo depois dos 100%
- [x] 6.5: Mudança de severidade recalcula os marcos sobre o prazo novo, inclusive disparando o de
      100% na hora quando o tempo já corrido excede o prazo que passou a valer
- [x] 6.6: Limiar separado para ocorrência abandonada, com mensagem própria
- [x] 6.7: Consolidação disparada no fechamento
- [x] 6.8: Tópico próprio para os marcos, com retenção adequada ao reprocessamento
- [x] 6.9: App, chart e `ArgoCD Application` — instância única, o relógio não pode emitir duas vezes
- [x] 6.10: Reconstrução do estado na subida, sem depender do que estava em cache
- [x] 6.11: Métricas e testes do cálculo de marco por gravidade

### Verification

- [x] Uma ocorrência que atravessa o prazo gera os quatro marcos, na ordem e nos instantes corretos
- [x] Ocorrência resolvida antes de um marco não o gera
- [x] Reinício do serviço não reemite marco já emitido

---

## Phase 7: Treinos revistos

A unidade de exemplo muda: deixa de ser uma ocorrência e passa a ser (ocorrência × marco).

`daily_anomaly_features` (cadeia `alert`) não tinha task própria de reconstrução — descoberto ao
começar esta fase que `ml-trainer.volume` ficou sem fonte desde a Fase 5 (a versão que sobreviveu,
`gold_monitor_daily_features`, é sinal do `monitor` para o detector de evento externo, não série de
incidentes para previsão de volume). Decisão do usuário, 2026-08-20: reconstruir como
`gold_alert_daily_features`, sobre `silver_alert`, mesma forma da antiga.

Fase inteira detalhada em spec.md, seção "Treino revisto", depois de conferir contra o `ml-trainer`
real (`apps/ml-trainer/src/breach|volume|external_event/`) e `docs/insights/fluxo-do-incidente.md` —
que já tinha, sem eu ter lido antes de configurar a Fase 6, a análise do teto de abandono (10× o
OLA). Decisões do usuário, 2026-08-20, todas em spec.md: rótulo é `has_breached` (não
`kpi_breached` — apuração é julgamento de negócio não documentado pela Locaweb, não fato técnico);
teto de abandono 10.0 (corrige também `abandoned_ratio` do acompanhador de prazo, Fase 6, que estava
em 3.0 sem base); ruído de duração ínfima cortado por percentil 1 com piso de 60s. `group_load_1h`
não dá mais pra ler de `group_load_by_window` (virou snapshot do "agora" na Fase 5) — recalculada
ponto-no-tempo na própria montagem do dataset (7.1). `external_event` também ficou sem fonte e não
tinha task — 7.10, abaixo.

### Tasks

- [ ] 7.1: Conjunto de treino montado a partir do bronze, com o que se sabia em cada marco —
      `silver_alert_as_of(cutoff=marco.occurred_at)`, `group_load` ponto-no-tempo calculado aqui
- [ ] 7.2: Features de contexto vindas do gold da cadeia `monitor`, por entity
- [ ] 7.3: Features de prazo — consumo, tempo restante, se houve reconhecimento
- [ ] 7.4: Rótulo `has_breached`; exclusões do treino — `is_eligible`, abandono (≥10×), ruído de
      duração (percentil 1, piso 60s)
- [ ] 7.5: Modelo de risco retreinado sobre a nova unidade, com o desbalanceamento reavaliado
- [ ] 7.6: Modelo de volume revisto, sobre `gold_alert_daily_features` — série de ocorrências que
      exigem trabalho separada do ruído
- [ ] 7.7: Serving atualizado para o novo conjunto de features (trainer e `ml-model-serving` juntos —
      `schemas.py` espelha `FEATURE_COLUMNS` com `extra="forbid"`)
- [ ] 7.8: Testes das features novas e da montagem por marco
- [x] 7.9: Reconstruir `daily_anomaly_features` (cadeia `alert`) como `gold_alert_daily_features`,
      fonte de 7.6 — desenho revisto na Fase 5 (sem `in_kpi`/`breached`/`breach_rate`, `p1_count` a
      `p5_count`)
- [ ] 7.10: `external_event` revisto sobre `gold_monitor_daily_features` (cadeia `monitor`), fonte
      nova decidida nas Fases 4/5 mas sem task até agora
- [ ] 7.11: Corrigir `abandoned_ratio` de `apps/data-deadline-tracker` de 3.0 para 10.0

### Verification

- [ ] Nenhuma feature usa informação posterior ao instante do marco
- [ ] Uma ocorrência que atravessa três marcos gera três exemplos distintos
- [ ] Serving responde com o conjunto de features novo

---

## Final Verification

- [ ] Todos os acceptance criteria da spec atendidos
- [ ] Testes verdes das apps tocadas
- [ ] ArgoCD reconciliando os charts da track sem drift
- [ ] `docs/insights/fluxo-do-incidente.md` atualizado com o que a construção mudou no desenho
- [ ] PR mergeado em `main` com revisão

---

_Generated by Conductor. Tasks will be marked [~] in progress and [x] complete._
