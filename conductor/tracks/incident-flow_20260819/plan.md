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
- [x] 1.9: `source` sai do contrato de entrada — a origem não se declara, é o gateway que determina
- [x] 1.10: Formato do dicionário de tradução: como uma origem declara seus valores e como a versão
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

- [ ] 2.1: Rota de entrada por origem, versionada, com a credencial da integração vinculada a ela
- [ ] 2.2: Envelope atribuído pelo gateway: identidade do evento, origem, entrada, versão do
      formato e instante de recepção — nada lido do corpo
- [ ] 2.3: Publicação no tópico cru correspondente à natureza da origem
- [ ] 2.4: Métricas por origem e por natureza

**Bronze**

- [ ] 2.5: Tabelas de bronze append-only por natureza, com o corpo preservado como chegou
- [ ] 2.6: Cópia em arquivo particionada por origem e por data de recepção, com o corpo como coluna
      de texto
- [ ] 2.7: Destino do tópico atual: `incidents.received` é descontinuado — sem alias, sem preservar
      o dado antigo (decisão do usuário, 2026-08-19: as tabelas e tópicos de hoje viram lixo assim
      que as novas existirem, nada a migrar)

**Corte de `incidents.received`**

Descoberto ao planejar o corte: o plan.md original só cobria a migração do `data-ingest`, mas dois
outros consumidores leem de `incidents.received`/`incidents_received` hoje e ficariam quebrados sem
tarefa própria — corrigido aqui antes da Fase 2 começar a implementar.

- [ ] 2.7.1: Migrar `ml-burst-detector` para consumir `incidents.monitor` — a natureza dele é
      monitoração por entity (z-score/CUSUM sobre sinal), não gestão de ocorrência
- [ ] 2.7.2: Migrar `stg_incidents.sql` (data-runner) para a fonte traduzida da cadeia `alert`
- [ ] 2.7.3: Descontinuar a tabela `incidents_received` do ClickHouse e o tópico `incidents.received`
      do chart `data-kafka` — nenhum consumidor aponta mais para eles

**Tradução**

- [ ] 2.8: Estágio de tradução como componente próprio, consumindo o tópico cru — vive dentro do
      `data-ingest` existente, não em app novo (decisão do usuário, 2026-08-19)
- [ ] 2.9: Dicionário por origem fora do código, versionado — ciclo de vida, condição e o que
      originou o registro, mapeados no vocabulário do domínio
- [ ] 2.10: Valor fora do dicionário vira o caso desconhecido e fica visível, sem falhar o evento
- [ ] 2.11: Publicação no tópico traduzido, que é o que os consumidores de negócio leem
- [ ] 2.12: Reprocessamento de um período com uma versão de dicionário, sem sobrescrever o resultado
      anterior
- [ ] 2.13: `ScaledObject` para os consumidores da ingestão e da tradução

**Testes**

- [ ] 2.14: Tradução por origem, incluindo valor fora do dicionário
- [ ] 2.15: Payload que tenta declarar a própria origem não influencia o envelope
- [ ] 2.16: Reprocessamento produz resultado determinístico para uma dada versão de dicionário

### Verification

- [ ] O corpo é gravado antes de qualquer interpretação
- [ ] Nenhum consumidor de negócio lê o tópico cru
- [ ] Uma transição de estado chega como mensagem própria, não como atualização do mesmo registro
- [ ] Corrigir o dicionário e reprocessar um período gera resultado novo sem perder o anterior
- [ ] Origem nova não altera contrato traduzido nem consumidor
- [ ] Nada no repositório aponta mais para `incidents.received` ou `incidents_received`

---

## Phase 3: Estado atual por cadeia

Com stream, contar linha de bronze passa a contar evento, não ocorrência.

### Tasks

- [ ] 3.1: Estado atual da cadeia `alert`: última versão por identidade, com deduplicação
- [ ] 3.2: Estado atual da cadeia `monitor`: quais condições estão ativas por entity
- [ ] 3.3: Campos derivados calculados aqui, não recebidos: duração, elegibilidade, consumo de prazo
- [ ] 3.4: Reconstrução do estado em um instante passado a partir do bronze
- [ ] 3.5: Testes de que a deduplicação não multiplica contagem

### Verification

- [ ] Contagens coerentes com número de ocorrências, não de eventos
- [ ] O estado em um instante passado pode ser reconstruído sem depender do estado atual

---

## Phase 4: Gold da cadeia `monitor`

Agregações por entity. Insumo de análise, não produto de tela.

### Tasks

- [ ] 4.1: Contagem por entity e janela, sobre a nova chave e a nova fonte
- [ ] 4.2: Taxa de auto-resolução por entity
- [ ] 4.3: Intervalo típico entre sinais por entity
- [ ] 4.4: Sequência de severidade crescente por entity
- [ ] 4.5: Agregações diárias para o detector de evento externo
- [ ] 4.6: Snapshot em cache do que o caminho de inferência consome
- [ ] 4.7: Testes de cada agregação e do snapshot

### Verification

- [ ] As agregações existem para entity sem nenhuma ocorrência aberta
- [ ] Os números batem com a contagem direta no bronze da cadeia

---

## Phase 5: Gold da cadeia `alert`

O que o negócio consome: prazo, responsável, desfecho.

### Tasks

- [ ] 5.1: Consolidação de quebra por ocorrência fechada — duração, se estourou e por quanto
- [ ] 5.2: Estado mensal do KPI, com realizado e com o que está em risco
- [ ] 5.3: Tempo no primeiro grupo de atendimento, sobre a nova chave
- [ ] 5.4: Carga por grupo e janela, contando o que está vivo
- [ ] 5.5: Histórico de mudança de gravidade
- [ ] 5.6: Testes de cada mart e das regras derivadas

### Verification

- [ ] Nenhum mart depende de veredito recebido da origem
- [ ] Os números continuam coerentes com o histórico conhecido

---

## Phase 6: Acompanhador de prazo

A peça que reage à passagem do tempo, não a evento de origem.

### Tasks

- [ ] 6.1: Serviço que mantém o conjunto de ocorrências abertas, reconstruível do bronze
- [ ] 6.2: Cálculo do instante em que cada aberta cruza 25%, 50%, 75% e 100% do prazo
- [ ] 6.3: Emissão do marco com o que se sabia naquele instante
- [ ] 6.4: Nenhum marco de prazo depois dos 100%
- [ ] 6.5: Mudança de severidade recalcula os marcos sobre o prazo novo, inclusive disparando o de
      100% na hora quando o tempo já corrido excede o prazo que passou a valer
- [ ] 6.6: Limiar separado para ocorrência abandonada, com mensagem própria
- [ ] 6.7: Consolidação disparada no fechamento
- [ ] 6.8: Tópico próprio para os marcos, com retenção adequada ao reprocessamento
- [ ] 6.9: App, chart e `ArgoCD Application` — instância única, o relógio não pode emitir duas vezes
- [ ] 6.10: Reconstrução do estado na subida, sem depender do que estava em cache
- [ ] 6.11: Métricas e testes do cálculo de marco por gravidade

### Verification

- [ ] Uma ocorrência que atravessa o prazo gera os quatro marcos, na ordem e nos instantes corretos
- [ ] Ocorrência resolvida antes de um marco não o gera
- [ ] Reinício do serviço não reemite marco já emitido

---

## Phase 7: Treinos revistos

A unidade de exemplo muda: deixa de ser uma ocorrência e passa a ser (ocorrência × marco).

### Tasks

- [ ] 7.1: Conjunto de treino montado a partir do bronze, com o que se sabia em cada marco
- [ ] 7.2: Features de contexto vindas do gold da cadeia `monitor`, por entity
- [ ] 7.3: Features de prazo — consumo, tempo restante, se houve reconhecimento
- [ ] 7.4: Rótulo derivado, não recebido; decidir e registrar o teto que separa estouro de abandono
- [ ] 7.5: Modelo de risco retreinado sobre a nova unidade, com o desbalanceamento reavaliado
- [ ] 7.6: Modelo de volume revisto — série de ocorrências que exigem trabalho separada do ruído
- [ ] 7.7: Serving atualizado para o novo conjunto de features
- [ ] 7.8: Testes das features novas e da montagem por marco

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
