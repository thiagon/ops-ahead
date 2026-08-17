# Sprint 3 — MVP Preliminar (Evidências de Construção)

## Nome do Projeto

**Ops Ahead** — operação à frente, visão antecipada.

---

## 1. O que mudou desde a Sprint 2

A arquitetura da Sprint 2 segue válida sem alteração de tecnologia ou escopo. O que muda nesta sprint é a natureza do trabalho: saímos de design para construção. A atualização é de **postura**, não de plano.

| Dimensão | Sprint 2 | Sprint 3 |
|----------|----------|----------|
| Produto entregue | Arquitetura e decisões técnicas documentadas | Código rodando que testa as hipóteses do projeto |
| Evidência | Diagramas, wireframes, tabelas de componente | Modelos treinados, pipeline executando, UI respondendo |
| Risco principal | Escolher a stack errada | Construir o que não valida nada |
| Pergunta central | "Como isso funciona?" | "Isso funciona de verdade?" |

**Uma confirmação importante vinda da análise mais profunda do dataset:** a hipótese de precursor P4 foi confirmada quantitativamente antes de começar a construção. Dos ICs que geraram P2 no histórico, a esmagadora maioria tinha sequência crescente de eventos P4 no mesmo IC nas horas anteriores — validando o sinal que motivou a feature `detect_p4_escalation` na Sprint 2. Construir o modelo de breach sem essa feature seria deixar o sinal mais forte de fora.

---

## 2. Arquitetura da Solução (Confirmada)

O desenho da arquitetura é obrigatório em toda entrega. A estrutura de quatro camadas da Sprint 2 segue sem modificação — o diagrama abaixo é a referência de construção do MVP.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                           CAMADA 4 — DECISÃO (UI)                              │
│   Painel Interativo (Next.js) · Painel Tático (Grafana) · Motor de Integração │
└────────────────────────────────────────────────────────────────────────────────┘
                ▲                          ▲                       ▲
                │ recomendações            │ métricas              │ scores
┌───────────────┴──────────────────────────┴───────────────────────┴────────────┐
│                       CAMADA 3 — COPILOTO IA (Triagem)                        │
│   LangGraph · function calling · RAG (pgvector) · guardrails                  │
└───────────────────────────────────────────────────────────────────────────────┘
                ▲                          ▲                       ▲
┌───────────────┴──────────────────────────┴───────────────────────┴────────────┐
│                    CAMADA 2 — INTELIGÊNCIA (Modelos ML)                       │
│  Volume (LightGBM + Prophet) · Breach (LightGBM + isotonic + SHAP)            │
│  Rajada (z-score + CUSUM) · MLflow · FastAPI                                  │
└───────────────────────────────────────────────────────────────────────────────┘
                ▲                          ▲                       ▲
┌───────────────┴──────────────────────────┴───────────────────────┴────────────┐
│                     CAMADA 1 — DADOS (Pipeline)                               │
│  MinIO (lake) · ClickHouse (warehouse) · dbt · Argo Workflows                 │
│  Great Expectations · Simulador de stream (demo sem webhook real)             │
└───────────────────────────────────────────────────────────────────────────────┘
                                       ▲
                             incidents.csv / simulador
```

O que muda em relação ao diagrama completo da Sprint 2: o MVP **não implementa** Feast (feature store), Langfuse (auditoria LLM), Grafana tático, Authentik (SSO) e a projeção Monte Carlo completa. Essas peças ficam para a Sprint 4. A arquitetura cabe — o que muda é até onde chegamos nesta sprint.

---

## 3. Estratégia do MVP

### O que o MVP precisa provar

O MVP do Ops Ahead não é uma demo funcional qualquer — é a resposta para três perguntas que ainda não têm resposta em código:

1. **O sinal preditivo existe no dado real?**
   O EDA indicou padrões (precursor P4, rajadas de "Sem Intervenção", concentração de carga no Team14). O modelo de breach e o detector de rajada, treinados e avaliados no hold-out, vão dizer se esses padrões se traduzem em poder preditivo real — ou se eram ruído que parecia sinal.

2. **O fluxo E2E fecha em tempo útil?**
   A arquitetura da Sprint 2 prometeu < 60s da abertura do incidente à recomendação no Slack. O MVP tem que rodar esse fluxo de ponta a ponta com dado real e medir o tempo. Se não fechar, tem um gargalo de design para resolver antes da Sprint 4.

3. **A recomendação do copiloto é acionável?**
   Com as ferramentas implementadas no MVP, o agente vai produzir recomendações sobre alertas reais do histórico. Uma avaliação informal (time comparando com a ação registrada no dataset) vai dizer se o conteúdo do alerta faz sentido operacional — ou se o copiloto está falando besteira com confiança.

Essas três perguntas definem o escopo do MVP. **Tudo o que não responde a elas fica para a Sprint 4.**

### Escopo do MVP — o que entra e o que sai

| O que entra no MVP | Por que é essencial agora |
|--------------------|--------------------------|
| Pipeline Argo: ingestão → dbt → GE | Sem pipeline funcionando, não há dado para treinar nem para o copiloto consultar |
| Simulador de stream | Sem webhook real do ITSM, o simulador é o único jeito de rodar o fluxo E2E end-to-end |
| Modelos de volume e breach treinados e servidos | São a hipótese central do projeto — se não funcionam no dado real, o projeto não vai pra frente |
| Detector de rajada (`burst-detector`) | É o gatilho primário do fluxo — sem ele, o copiloto não é invocado |
| Copiloto com 3 ferramentas mínimas | Bastante para testar se a saída do LLM é acionável; não precisamos de 9 ferramentas para isso |
| Painel N1/N2 com fila + drill-down | Necessário para a avaliação informal — o avaliador precisa ver a recomendação em contexto |
| Fan-out Slack (Block Kit) | Testa o caminho real de entrega — Slack é onde o operador age |

| O que sai do MVP | Por que pode esperar |
|-----------------|---------------------|
| Feast (feature store) | Redis direto é suficiente para as features online do MVP; Feast adiciona robustez, não funcionalidade nova |
| Langfuse | Auditoria em Postgres já registra o necessário para a avaliação informal |
| Grafana tático | O gestor não está na avaliação do MVP; painel tático é Sprint 4 |
| Authentik (SSO) | Header fixo de dev não é risco no MVP; autenticação real é Sprint 4 |
| Projeção KPI Monte Carlo (endpoint) | A lógica Python pode ser validada como script antes de virar endpoint |
| Detector de evento externo (Isolation Forest endpoint) | Modelo pode ser treinado no MVP; servir fica para Sprint 4 |
| 6 ferramentas restantes do copiloto | As 3 mínimas testam a hipótese de acionabilidade — as demais refinam |

---

## 4. Como vamos construir — abordagem por camada

### 4.1 Camada 1 — Pipeline de Dados

**O problema central:** o `incidents.csv` é estático. Para simular um sistema que processa eventos em near-real-time, precisamos de dois modos de operação: bootstrap completo (carrega o histórico todo de uma vez) e stream simulado (relê o CSV em ordem cronológica para demo do fluxo E2E).

**Abordagem:**

O pipeline roda como DAG no Argo Workflows com quatro steps em sequência:

```
[ingest] → [dbt-run] → [great-expectations] → [register-snapshot]
```

O step `ingest` faz o bootstrap completo do CSV para MinIO e ClickHouse. Para a demo E2E, o simulador (`scripts/incident_producer.py`) relê o CSV com aceleração configurável fazendo POST para o `gateway /webhook/incidents` — o mesmo caminho que o webhook real do ITSM usaria em produção.

O step `dbt-run` constrói os seis marts que as camadas superiores consomem. A ordem de execução importa — alguns marts dependem de outros:

```
incidents_by_ic (base)
    ↓
p4_sequences_by_ci     priority_changes_log     daily_anomaly_features
    ↓                           ↓                         ↓
first_touch_duration      (alimenta breach)         kpi_monthly_state
```

O step `great-expectations` roda uma suite de validações sobre cada mart antes de promovê-los para consumo. A decisão de design importante aqui: **falha crítica pausa a DAG inteira**. Não queremos dados sujos chegando nos modelos silenciosamente.

**Validações prioritárias para o MVP:**
- `incidente_id` único em todos os marts
- `prioridade_codigo` dentro do domínio esperado (1–5)
- `aberto_em` nunca maior que `fechado_em`
- Contagem de linhas coerente com o dataset de origem (sem perda silenciosa de registros)

### 4.2 Camada 2 — Modelos de ML

**Contexto do dataset que guia as escolhas de modelagem:**

O dataset tem características que exigem decisões técnicas específicas:

- **Desbalanceamento extremo no breach:** apenas 1% dos incidentes elegíveis ao KPI resultam em violação (248 de ~25.600). Um modelo ingênuo preveria "não vai violar" em tudo e teria 99% de acurácia. A métrica que importa é AUC-PR e recall@top-k — não acurácia.
- **Série temporal com sazonalidade forte:** volume de incidentes varia ~30% entre dias úteis e fins de semana, com pico confirmado entre 10h–16h. Split de validação tem que ser temporal — validação cruzada aleatória vaza futuro para o treino.
- **65,6% de "Sem Intervenção":** a maioria dos incidentes se resolve sozinha. O modelo de breach é treinado apenas em incidentes elegíveis ao KPI — esse filtro remove o ruído estrutural do dataset.
- **3 servidores concentrando ~11% do volume:** features de IC específico têm poder preditivo relevante, mas exigem cuidado com data leakage (não podemos usar informação futura do IC como feature de treino).

**Modelo de Volume (D+1 e D+7):**

O objetivo é prever o volume de incidentes por prioridade para amanhã e para os próximos 7 dias. LightGBM como modelo principal, Prophet como baseline e sanity check — se o LightGBM não bater Prophet consistentemente, algo está errado nas features.

Features críticas identificadas no EDA:
- Lags de 1, 7 e 14 dias (captura sazonalidade semanal e quinzenal)
- Média móvel de 7 e 30 dias (captura tendência)
- Componentes de Fourier para ciclo semanal (mais robusto que dummies de dia da semana)
- Flag de feriado nacional
- Hora de abertura (sazonalidade horária confirmada pela mentoria)

Split temporal: treino em até set/2025, validação out/2025, hold-out nov/2025–jan/2026. A escolha da janela de validação importa — out/2025 e nov/2025 têm comportamento razoavelmente normal; o hold-out inclui o pico de set/2025 que está no dataset (meses antes dele no treino, comportamento anômalo no teste).

**Modelo de Breach:**

Classificação binária com LightGBM. O dataset de treino são apenas os incidentes elegíveis ao KPI — sem incidente pai preenchido, sem "Sem Intervenção", prioridades 1 a 3.

Features de domínio que entram por causa da mentoria:
- Idade do chamado vs. OLA da prioridade (quanto do tempo já foi consumido)
- Tempo no primeiro grupo de toque vs. limite de 25% do OLA (regra do N1 revelada pelo Douglas)
- Contagem de "Sem Intervenção" no mesmo IC na última hora e nas últimas 6 horas
- Sequência crescente de P4 no mesmo IC (precursor confirmado no EDA)
- Flag de abertura manual (~14–15% dos chamados — sinal de gap de observabilidade)
- Carga do grupo designado no momento da abertura (via snapshot Redis)
- Hora do dia e dia da semana

Calibração isotônica pós-treino é obrigatória: `class_weight='balanced'` resolve o desbalanceamento para a predição binária, mas distorce a probabilidade calibrada. Sem calibração o score não tem leitura direta de probabilidade — e o copiloto usa o score como entrada para priorizar ação.

SHAP por inferência: calculado a cada predição e salvo com o score. No MVP, SHAP aparece no drill-down do painel e na justificativa gerada pelo copiloto.

**Detector de Rajada (`burst-detector`):**

Sem treino — só estatística. Isso é uma vantagem: atualiza online com cada novo evento, sem risco de overfitting, sem ciclo de retreino.

O limiar adaptativo por IC é a decisão de design mais importante aqui. Um limiar global gera falsos positivos no Team14 (que tem volume naturalmente alto) e falsos negativos em ICs silenciosos que raramente disparam. O z-score é calculado sobre a mediana + MAD histórico de cada IC individualmente.

A combinação z-score + CUSUM cobre dois casos distintos: pico pontual alto (z-score pega) e mudança de regime gradual onde nenhum ponto individual cruza o threshold mas a série toda sobe (CUSUM pega). Os dois juntos são mais robustos do que qualquer um sozinho.

**Status (2026-08-17):** os quatro componentes estão implementados, mergeados em `main` (PR #51) e
validados estruturalmente contra dado real do cluster — detalhes em `docs/insights/ml_models_baseline.md`.
Os números de qualidade preditiva (MAPE, AUC-PR, recall@top-k) sobre o dataset completo dependem de uma
ingestão que ainda não rodou até o fim nesta instância; ficam como follow-up, não bloqueiam o MVP.

### 4.3 Camada 3 — Copiloto IA

**O que o MVP precisa testar no copiloto:**

A pergunta não é "o LLM funciona?" — isso é dado. A pergunta é "com as ferramentas disponíveis, o agente produz uma recomendação que faz sentido para quem vai agir?". Para isso, três ferramentas são suficientes no MVP:

- `get_recent_incidents(ic, janela_horas)` — contexto do IC nas últimas horas
- `find_similar_resolved(ic, prioridade, descricao)` — o que funcionou em casos parecidos
- `get_ola_window(prioridade, aberto_em)` — urgência objetiva

Com essas três, o copiloto já consegue produzir: "escalar para N2 — este IC teve 12 ocorrências nas últimas 6h, caso similar ao INC0042131 foi resolvido em 22 min pelo Team02, OLA expira em 1h15". É acionável. Adicionar mais ferramentas melhora o contexto, mas não muda se a hipótese de acionabilidade é válida.

**Grafo LangGraph do MVP:**

```
[receber_alerta]
       ↓
[planejar_ferramentas]   ← LLM decide quais ferramentas chamar
       ↓
[executar_ferramentas]   ← chamadas paralelas quando possível
       ↓
[gerar_recomendacao]     ← LLM gera JSON com o schema fixo
       ↓
[validar_json]           ← Pydantic valida
       ↓ falha                    ↓ sucesso
[retry com correção]      [salvar em recommendations]
       ↓ 2º erro
[fallback: alerta cru + flag agent_failed=true]
```

O fallback é essencial para o MVP: o copiloto não pode ser um ponto único de falha. Se o LLM produzir JSON inválido duas vezes, o alerta passa mesmo assim — sem recomendação, mas visível.

**RAG (pgvector):**

O `find_similar_resolved` usa embeddings de descrição de incidentes resolvidos com o campo de resolução preenchido. No MVP, indexamos os incidentes do dataset com `status != "Sem Intervenção"` e `duracao_segundos > 60` (filtra ruído dos resolvidos em < 1 min). A query combina similaridade de embedding com filtros estruturados (IC, prioridade) numa única query SQL — sem sistema externo de busca vetorial.

**LiteLLM como gateway LLM-agnóstico:**

O `agent` nunca chama a API da Anthropic diretamente. Toda chamada passa pelo LiteLLM proxy. Isso tem consequência prática no MVP: se o custo da API começar a subir durante o desenvolvimento (muitas iterações de prompt), o `ConfigMap` do LiteLLM troca para um modelo menor sem tocar uma linha do `agent`. Cache de prompt habilitado — sistema + descrição das ferramentas (~6k tokens) ficam em cache de 5 min, reduzindo custo nas sequências de alertas que chegam juntos.

### 4.4 Camada 4 — Interfaces

**Princípio que guia o escopo da UI no MVP:**

O operador não vai abandonar o Slack para abrir o painel — isso foi validado na Sprint 2 como decisão de design. O MVP tem que entregar nos dois canais, mas com prioridade diferente:

- **Slack (Block Kit)** é a interface de ação. O operador age pelo Slack sem abrir nada.
- **Painel N1/N2** é a interface de auditoria. O avaliador do blind review precisa ver a fila completa e o drill-down para avaliar as recomendações.

O painel tático (Grafana) é gestão — não está na avaliação do MVP, vai para Sprint 4.

**Block Kit do Slack:**

Cada recomendação com criticidade ≥ 4 gera uma mensagem em `#ops-ahead-alertas` com:
- IC, grupo, score de breach, janela OLA
- Ação recomendada e justificativa em uma frase
- Botões: `Ack & Aplicar`, `Ignorar (motivo)`, `Ver no painel`

O clique no botão chama `/slack/actions` no `gateway`, que registra a ação e publica em `actions.taken`. Esse registro alimenta o conjunto de avaliação.

**Painel N1/N2 (Next.js):**

Fila de recomendações ordenada por criticidade. Cada card tem:
- Leitura primária em 5 segundos: IC, ação, janela
- Drill-down a um clique: SHAP top-5, ferramentas chamadas com argumentos e resultados, incidentes similares

O painel não tem autenticação no MVP — header fixo de dev. SSO Keycloak é Sprint 4.

---

## 5. Como vamos validar o MVP

O MVP não é validado por demo bonita — é validado por evidência em dado real.

### Validações por componente

**Pipeline:**
- DAG completa sem falha em todo o `incidents.csv` (122.543 linhas)
- Great Expectations sem check crítico falhando nos dados reais
- Todos os 6 marts com linhas coerentes com o dataset de origem

**Modelos:**
- Modelo de volume: MAPE em hold-out por prioridade; cobertura do intervalo de confiança
- Modelo de breach: AUC-PR e recall@top-10 e top-50 por hora em hold-out temporal
- Detector de rajada: precision dos alertas e lead-time mediano antes do P2 (usando o histórico real do CSV como ground truth)

**Fluxo E2E:**
- Tempo total do simulador publicar o incidente até o Block Kit aparecer no Slack
- Meta: < 60 segundos (SLI definido na Sprint 2)
- Medir em 20 execuções com incidentes distintos do dataset

**Copiloto:**
- Blind review em 50 alertas históricos do hold-out
- O time avalia: a ação recomendada faz sentido dado o contexto? Concorda com o que o operador faria?
- Registrar os padrões de divergência — não para corrigir no MVP, mas para priorizar ferramentas na Sprint 4

### O que esses resultados nos dizem

- Se o AUC-PR do breach for muito baixo (< 0,5), o sinal não é suficiente para o produto prometido — teríamos que repensar a proposta antes da Sprint 4.
- Se o fluxo E2E não fechar em < 60s, tem um gargalo de arquitetura para resolver.
- Se o blind review mostrar concordância baixa (< 60%), o copiloto com 3 ferramentas não é suficiente e precisamos priorizar `get_group_load` e `get_breach_score` para a Sprint 4.

---

## 6. Gerenciamento do Projeto (Scrumban — Sprint 3)

### Scrum Master: Raphael Moraes

### Distribuição mensal

| Mês | Foco | O que entrega |
|-----|------|--------------|
| **Junho** | Stack mínima + pipeline | Helm charts da stack, DAG Argo rodando, 6 marts validados pelo GE, simulador de stream |
| **Julho** | Modelos + painel | Modelo de volume e breach registrados em MLflow, `burst-detector`, `model-serving`, painel N1/N2 com fila e drill-down |
| **Agosto** | Copiloto + integração + validação + entrega | `agent` com 3 ferramentas, LiteLLM + Claude, RAG pgvector, Block Kit Slack, blind review de 50 alertas, slides + PPTX |

### Backlog da Sprint 3

#### Spike técnico — LangGraph (2 dias antes do mês 1)
**Responsável:** Thiago Nunes
**Período:** semana de 25/05/2026
**Descrição:** antes de começar a construção do `agent`, o time precisa ter clareza sobre o funcionamento do LangGraph. Dois dias de spike para não construir sobre hipóteses erradas.
**Tasks:**
- [ ] Implementar grafo simples com dois nós e uma ferramenta chamada
- [ ] Testar mecanismo de retry (JSON inválido → mensagem de correção → nova tentativa)
- [ ] Confirmar que LangGraph suporta chamadas paralelas de ferramentas (importante para latência)
- [ ] Decidir: Feast vs. Redis direto para features online no MVP

#### Helm charts da stack mínima
**Responsável:** Samuel Gusman
**Período:** Junho, semana 1
**Descrição:** stack mínima que sobe com `helm install` por namespace. Sem Helm charts funcionando, o time não tem onde rodar nada.
**Tasks:**
- [ ] Chart `ns: data` — MinIO, ClickHouse (Altinity Operator), Kafka (Strimzi), Argo Workflows
- [ ] Chart `ns: ml` — MLflow + Postgres, Redis, `model-serving` (stub)
- [ ] Chart `ns: agent` — LiteLLM proxy, Postgres (pgvector), `agent` (stub)
- [ ] Chart `ns: ui` — `gateway` (stub), `ui` (stub)
- [ ] Overlay `dev` com recursos reduzidos (1 réplica, sem HPA, sem TLS)
- [ ] Teste: `helm install` do zero em k3s local sem erro manual

#### Simulador de stream
**Responsável:** Samuel Gusman
**Período:** Junho, semana 1
**Descrição:** sem o simulador, o fluxo E2E não pode ser testado. É pré-requisito para quase tudo a partir do mês 2.
**Tasks:**
- [ ] `scripts/incident_producer.py --speed <N>x` — replay N× mais rápido que o tempo real do dataset
- [ ] Faz POST para `gateway /webhook/incidents` com o payload bruto do ITSM — mesmo contrato do webhook real
- [ ] Flag `--incident-ids` para replay de incidentes específicos (útil para demo da apresentação)
- [ ] Flag `--limit` para testes rápidos com subconjunto do dataset

#### DAG Argo — ingestão + dbt + GE
**Responsável:** Samuel Gusman
**Período:** Junho, semanas 2–3
**Descrição:** DAG que transforma o CSV em marts validados. Primeiro artefato de código de infraestrutura de dados do projeto.
**Tasks:**
- [ ] Step `ingest`: bootstrap do CSV no MinIO (Parquet particionado por data) e ClickHouse
- [ ] Step `dbt-run`: `dbt run --select marts.*` em ClickHouse
- [ ] Step `great-expectations`: suite de validações; falha crítica pausa a DAG
- [ ] Step `register-snapshot`: registra hash do dataset e timestamp no MLflow
- [ ] DAG completa em < 15 min no dataset de 122.543 linhas

#### dbt — 6 marts essenciais
**Responsável:** Gustavo Neves
**Período:** Junho, semanas 2–4
**Descrição:** os marts são o contrato de dados entre a Camada 1 e as camadas superiores. Sem eles, modelos e copiloto não têm o que consumir.
**Tasks:**
- [ ] `marts/incidents_by_ic` — agregado por (IC × janela 1h/6h/24h)
- [ ] `marts/p4_sequences_by_ci` — sequências crescentes de P4 por IC (window function)
- [ ] `marts/first_touch_duration` — tempo cozinhado no primeiro grupo vs. OLA da prioridade
- [ ] `marts/priority_changes_log` — histórico de transições de `prioridade_codigo` no stream
- [ ] `marts/daily_anomaly_features` — features diárias agregadas (volume, share P1, abertura manual, dispersão de ICs)
- [ ] `marts/kpi_monthly_state` — estado mensal dos 4 KPIs do PPR por (prioridade × dimensão)
- [ ] Testes dbt em cada mart (`unique`, `not_null`, relações entre marts)

#### Modelo de volume D+1 / D+7
**Responsável:** Gustavo Neves
**Período:** Julho, semanas 1–2
**Descrição:** primeiro modelo treinado e versionado em MLflow. Entrega a previsão de volume que é a prioridade número 1 da mentoria.
**Tasks:**
- [ ] Feature engineering: lags 1/7/14d, médias móveis, Fourier semanal, feriado, hora do dia
- [ ] Split temporal: treino até set/2025, validação out/2025, hold-out nov/2025–jan/2026
- [ ] Treinar Prophet como baseline (sem features adicionais)
- [ ] Treinar LightGBM e calcular ensemble com Prophet por média ponderada
- [ ] Registrar experimento em MLflow (params, métricas, artefatos, versão do dataset)
- [ ] Promover para `Production` no MLflow Model Registry
- [ ] Expor via endpoint `POST /predict/volume` no `model-serving`

#### Modelo de breach (LightGBM + isotonic + SHAP)
**Responsável:** Thiago Nunes
**Período:** Julho, semanas 1–3
**Descrição:** o modelo mais crítico para a proposta do projeto. Tem que funcionar no dado real — se não funcionar, a proposta precisa ser revisada.
**Tasks:**
- [ ] Filtrar dataset de treino: P1–P3, sem incidente pai, sem "Sem Intervenção"
- [ ] Feature engineering: incluir precursor P4 do mart `p4_sequences_by_ci`, tempo no primeiro grupo do mart `first_touch_duration`, flag de abertura manual, snapshot de carga do grupo em Redis
- [ ] Otimização de hiperparâmetros (Optuna, 50 trials)
- [ ] Calibração isotônica pós-treino; plotar reliability diagram antes e depois
- [ ] SHAP calculado por inferência — top-5 salvo junto ao score no payload
- [ ] Registrar em MLflow, promover para `Production`
- [ ] Expor via endpoint `POST /predict/breach` no `model-serving`
- [ ] AUC-PR em hold-out > 0,60 (mínimo para o produto ser defensável)

#### `burst-detector` (worker Kafka + Redis)
**Responsável:** Samuel Gusman
**Período:** Julho, semana 2
**Descrição:** consumer stateless que mantém estado por IC em Redis e detecta rajadas em near-real-time.
**Tasks:**
- [ ] Consumer Kafka com grupo `burst-detector`, lê `incidents.received`
- [ ] Estado por IC em Redis: contagem por janela (15min, 1h, 6h), mediana histórica, MAD histórico
- [ ] z-score robusto por IC (mediana + MAD) — limiar adaptativo, não global
- [ ] CUSUM bidirecional para detecção de mudança de regime gradual
- [ ] Publicar em `alerts.burst` quando z > 3,5 em qualquer janela
- [ ] Containerizar como `Deployment` no `ns: ml` (worker puro, sem HTTP)
- [ ] Calcular lead-time mediano nos alertas gerados sobre o dataset histórico

#### `model-serving` — FastAPI para os dois modelos
**Responsável:** Gustavo Neves
**Período:** Julho, semana 3
**Descrição:** API que o copiloto e o gateway chamam para obter scores. Interface única entre os modelos e o resto do sistema.
**Tasks:**
- [ ] `POST /predict/volume` — retorna previsão D+1 e D+7 com intervalo de confiança
- [ ] `POST /predict/breach` — retorna score calibrado e SHAP top-5
- [ ] Carregamento dos artefatos do MLflow no startup via URI do registry
- [ ] Schemas Pydantic V2 em request e response
- [ ] Health check `/health` e métricas Prometheus em `/metrics`
- [ ] Deploy como `Deployment + HPA` no `ns: ml`

#### Painel N1/N2 (`ui`) — fila + drill-down
**Responsável:** Raphael Moraes
**Período:** Julho, semanas 3–4
**Descrição:** interface mínima para o blind review do copiloto. Sem o painel, o avaliador não consegue ver as recomendações em contexto.
**Tasks:**
- [ ] Fila de recomendações ordenada por criticidade (polling 10s)
- [ ] Card de recomendação: IC, grupo, ação recomendada, score, janela OLA
- [ ] Drill-down: SHAP top-5 (barra horizontal), ferramentas chamadas com argumentos e resultados, incidentes similares
- [ ] Filtros por prioridade e grupo designado
- [ ] Botões "Aplicar" e "Ignorar" — chama `gateway`, registra ação
- [ ] Deploy como `Deployment + Ingress` no `ns: ui`

#### Copiloto IA — `agent` com 3 ferramentas
**Responsável:** Thiago Nunes
**Período:** Agosto, semanas 1–2
**Descrição:** serviço `agent` com o grafo LangGraph e as três ferramentas mínimas para validar a hipótese de acionabilidade.
**Tasks:**
- [ ] FastAPI + LangGraph: grafo com nós `plan_tools`, `execute_tools`, `generate_recommendation`, `validate_json`
- [ ] `get_recent_incidents`: lê mart `incidents_by_ic` via ClickHouse
- [ ] `find_similar_resolved`: pgvector + filtros estruturados (IC, prioridade) numa única query SQL
- [ ] `get_ola_window`: cálculo determinístico baseado na prioridade e `aberto_em`
- [ ] Schema Pydantic da recomendação: `incidente_id`, `acao_recomendada`, `criticidade`, `score_breach`, `justificativa`, `similares`
- [ ] Retry com mensagem de correção (máx 2×); fallback `agent_failed=true`
- [ ] LiteLLM proxy integrado; cache de prompt habilitado; fallback GPT-4.1 no ConfigMap

#### RAG pgvector — indexação do dataset histórico
**Responsável:** João Porto
**Período:** Agosto, semana 1
**Descrição:** base de incidentes similares que o copiloto consulta. Sem isso, `find_similar_resolved` não funciona.
**Tasks:**
- [ ] Selecionar incidentes elegíveis: `status != "Sem Intervenção"`, `duracao_segundos > 60`, resolução preenchida
- [ ] Gerar embeddings com `all-MiniLM-L6-v2`
- [ ] Criar índice HNSW no Postgres (`ns: agent`)
- [ ] Verificar latência de recuperação < 50ms com filtros combinados
- [ ] `CronJob` semanal de reindexação incremental

#### Motor de Integração (`gateway`) — webhook + fan-out Slack
**Responsável:** João Porto
**Período:** Agosto, semana 2
**Descrição:** conecta o sistema ao mundo externo. Sem o `gateway`, não há Slack e não há demonstração do fluxo E2E.
**Tasks:**
- [ ] `POST /webhook/incidents` — valida HMAC, normaliza schema, publica em `incidents.received`
- [ ] Consumer de `recommendations` no Kafka — fan-out Slack para criticidade ≥ 4
- [ ] Block Kit: IC, grupo, score, ação, justificativa + botões `Ack & Aplicar`, `Ignorar (motivo)`, `Ver no painel`
- [ ] `POST /slack/actions` — valida HMAC, grava em Postgres, publica em `actions.taken`
- [ ] API pública `/api/v1/*` com OpenAPI gerado de schemas Zod

#### Blind review — 50 alertas históricos
**Responsável:** Time inteiro
**Período:** Agosto, semana 3
**Descrição:** a validação da hipótese de acionabilidade. É a evidência central do MVP.
**Tasks:**
- [ ] Selecionar 50 incidentes do hold-out com OLA em risco (score de breach > 0,5 ou rajada detectada)
- [ ] Rodar o agente em cada incidente e salvar a recomendação gerada
- [ ] Cada membro avalia independentemente: faz sentido a recomendação dado o contexto?
- [ ] Calcular concordância entre avaliadores e com a ação real registrada no dataset
- [ ] Mapear os padrões de divergência — esses padrões viram stories de ferramentas na Sprint 4

#### Validar fluxo E2E — tempo total
**Responsável:** Samuel Gusman
**Período:** Agosto, semana 3
**Descrição:** confirmar que o SLI de < 60s está sendo batido antes de entregar.
**Tasks:**
- [ ] Rodar o simulador com 20 incidentes distintos do dataset
- [ ] Medir o tempo de T+0 (simulador publica) até T+N (Block Kit aparece no Slack)
- [ ] Registrar mediana, p95 e identificar o step mais lento se mediana > 60s

#### Atualizar material e entregar
**Responsável:** João Porto (roteiro) + Raphael Moraes (slides) + Samuel Gusman (PPTX)
**Período:** Agosto, semana 4
**Tasks:**
- [ ] Atualizar `sprint-3-mvp.md` com resultados reais dos modelos e do blind review
- [ ] Roteiro dos slides (capa, equipe, problema, arquitetura, evidências por camada, métricas, blind review, gestão, finalização)
- [ ] Slides HTML em `docs/presentations/sprint-3.html`
- [ ] PPTX no padrão `EC_Sprint_3_2TSCOA_Evidencias_Construcao_OpsAhead_SuperDatados.pptx`
- [ ] Entrega no portal FIAP ON até 23/08/2026

---

## 7. Gestão de Riscos (atualizada)

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| AUC-PR do breach muito baixo (< 0,5) | Baixa | Alto | Analisar SHAP — se nenhuma feature individual importa, o sinal não existe no dado e precisamos revisar a proposta na Sprint 4 |
| Custo da API LLM no desenvolvimento | Média | Médio | Usar Claude Haiku para todas as iterações de prompt durante o desenvolvimento; só validar com Sonnet nos experimentos de avaliação |
| Fluxo E2E > 60s | Média | Médio | Instrumentar cada step do fluxo desde o início — identificar gargalo cedo, não na semana de entrega |
| Concordância do blind review < 60% | Média | Médio | Resultado ainda é válido — documental e mapeia o que priorizar na Sprint 4 |
| Helm charts maduros para Strimzi/Altinity | Baixa | Médio | Conferir na semana 1 de junho; cair para versão community se o operator tiver instabilidade |
| Dataset estático (sem stream real do ITSM) | Alta | Baixo | Mitigado pelo simulador — o briefing aceita evidências em dado histórico |

---

## 8. Finalização

O MVP define a linha entre o que foi arquitetado e o que foi provado. Ao final da Sprint 3, teremos uma resposta concreta para cada hipótese central:

- O sinal preditivo existe no dado real (modelos avaliados em hold-out temporal)
- O fluxo E2E fecha no tempo útil (< 60s medido com o simulador)
- A recomendação do copiloto faz sentido operacional (blind review sobre alertas históricos)

O que não validamos nesta sprint não é risco de proposta — é escopo de refinamento. A Sprint 4 constrói sobre evidências, não sobre suposições.

---

**Equipe Super Datados — FIAP Enterprise Challenge 2026 · Locaweb**

Gustavo Rodrigues Neves · João Gabriel Rodrigues Porto · Raphael Carlos da Silva Moraes · Samuel Calebe Gusman · Thiago Nunes Pereira
