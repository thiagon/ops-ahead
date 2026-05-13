# **Roteiro de Apresentação — SPRINT 2: Arquitetura, Desenho e Protótipos Iniciais (Locaweb Challenge 2026)**

> **Fonte de conteúdo:** `docs/sprint-02/arquitetura.md`
> **Brief obrigatório:** `docs/sprints/03-sprint-2-arquitetura.md`
> **Itens exigidos pelo brief:** (1) problema/público/proposta atualizados, (2) arquitetura + desenho inicial, (3) descrição da arquitetura, (4) protótipos com significado, (5) gerenciamento ágil, (6) finalização.
> **Padrão visual:** mesmo template da Sprint 1 (`docs/apresentacoes/sprint-1.html`) — paleta `#0B0F19 / #F9203E`, fontes Poppins/Inter/JetBrains Mono, slides 1280×720, footer "FIAP + locaweb".

---

## **SLIDE 1: Capa**

Estrutura centralizada, de cima para baixo:

- **Sobretítulo (pequeno, muted, letter-spacing 4px):** `FIAP + locaweb`
- **Título (grande, vermelho `--accent-red`):** `// OPS AHEAD`
- **Subtítulo (light):** `Operação à frente, visão antecipada.`
- **Tagline (vermelha, itálico):** `"Veja o incidente antes que ele aconteça"`
- **Rodapé (pequeno, muted, letter-spacing 4px):** `CHALLENGE LOCAWEB 2026`

## **SLIDE 2: Equipe**

- **Subtítulo do slide:** `SPRINT 2: ARQUITETURA E DESENHO DA SOLUÇÃO`
- **Pill (canto direito do título):** `SPRINT 2 / 4`
- **Equipe (ordem alfabética, foto + nome + RM):**
  - Gustavo Rodrigues Neves — RM561572
  - João Gabriel Rodrigues Porto — RM565092
  - Raphael Carlos da Silva Moraes — RM564098
  - Samuel Calebe Gusman — RM562124
  - Thiago Nunes Pereira — RM565900

## **SLIDE 3: O Cenário Locaweb**

_(Dica visual: número-destaque grande à esquerda + grid 2×2 de tiles numéricos à direita.)_

**Bloco principal (esquerda, ≈35%):**
- **`1/3`** do tráfego da internet brasileira
- 3,4 milhões de caixas de e-mail · 500 mil sites hospedados · BOPE 24×7

**Tiles numéricos (direita, grid 2×2):**

| Número | Rótulo | Significado |
| :--- | :--- | :--- |
| **65,6%** | "Sem Intervenção" | Auto-healing resolve, mas o sinal preditivo é descartado |
| **75,7%** | Concentrados no Team14 (N1) | Gargalo operacional claro |
| **248** | Breaches de OLA / ano | Apenas 1% do volume KPI — mas pressionam o bônus |
| **18%** | Incidentes < 60 segundos | Ruído competindo com sinal real |

**Rodapé do slide:** Análise de **122.543 incidentes** do ITSM. P1/P2 ≤ 4h · margem ≈ 36 breaches P2/ano para 100% da meta.

## **SLIDE 4: O Problema Operacional**

_(Dica visual: lead em vermelho no topo + grid 2×2 de feature-blocks com ícone, título e descrição.)_

**Lead:** Hoje a operação é **reativa** — age depois que o incidente já ocorreu.

| # | Título | Descrição |
| :--- | :--- | :--- |
| 1 | **Picos não antecipados** (`fa-clock-rotate-left`) | Volume varia ~30% entre dias úteis e fins de semana, mas sazonalidade não alimenta nenhuma previsão de escala. |
| 2 | **Sinais preditivos desperdiçados** (`fa-bolt`) | 80 mil "Sem Intervenção" anuais são descartadas do KPI, mas suas rajadas em um IC são o principal indicador de P2 iminente. Ninguém monitora. |
| 3 | **Risco de OLA invisível** (`fa-eye-slash`) | Os 248 breaches/ano pressionam diretamente o bônus, mas a equipe só descobre a violação depois que o prazo estourou. |
| 4 | **Concentração sem resposta** (`fa-database`) | Team14 absorve 75,7% dos incidentes; 3 servidores concentram ~11% do volume. Sem mecanismo para redistribuir antes da sobrecarga. |

## **SLIDE 5: Público-Alvo**

_(Dica visual: grid 2×2 de persona-cards — ícone redondo, tier em vermelho, nome, descrição.)_

| Tier | Persona | Descrição |
| :--- | :--- | :--- |
| **Público primário** (`fa-headset`) | Equipe BOPE (N1 / N2 / N3) | Sabe dos picos antes deles acontecerem e recebe os chamados em risco já priorizados na fila — menos pressão no plantão 24×7. |
| **Público técnico** (`fa-server`) | Time SRE / Plataforma | Mantém pipeline e agente em pé no dia-a-dia. Cuida de deploy, retreino dos modelos e do custo do LLM em produção. |
| **Público secundário** (`fa-chart-line`) | Gestores Operacionais e Diretoria | Decide escala da próxima semana com base em projeção, não em achismo. Acompanha as metas de OLA antes do mês fechar. |
| **Público indireto** (`fa-globe`) | Clientes Locaweb | Menos tempo fora do ar e mais estabilidade na infra que sustenta a operação deles. |

## **SLIDE 6: Proposta de Solução**

_(Dica visual: 4 tiles lado a lado, cada um com ícone vermelho, título, descrição e tech-row em monospace vermelha.)_

**Lead:** Quatro camadas integradas, **open-source e cloud-agnostic**, que transformam o sinal estatístico em **decisão acionável**.

| # | Camada | Descrição | Tecnologias |
| :--- | :--- | :--- | :--- |
| 1 | **Pipeline de Dados** (`fa-filter`) | Ingestão contínua do ITSM. Features temporais (lags, médias móveis), frequência por IC e filtro de ruído. | Kafka · MinIO/Iceberg · ClickHouse · dbt · Argo |
| 2 | **Modelos Preditivos** (`fa-brain`) | Previsão de volume D+1/D+7, score de risco de breach por chamado em aberto e detecção de rajada por IC. | LightGBM · Prophet · z-score+CUSUM · MLflow · Feast |
| 3 | **Copiloto IA Agêntica** (`fa-wand-magic-sparkles`) | No alerta, um **agente LLM** reavalia criticidade, busca contexto e entrega ao operador um **TL;DR de decisão**. | LangGraph · LiteLLM · Claude · pgvector · Pydantic |
| 4 | **Interface de Decisão** (`fa-display`) | Operador age **onde já vive** (Slack/OpsGenie). Painel agregado para N1/N2 e tático para gestores. | gateway (TS+Fastify) · ui (Next.js) · Grafana |

## **SLIDE 7: Arquitetura em 4 Camadas + 7 Princípios**

_(Dica visual: layout 2 colunas — esquerda mostra o stack vertical de 4 camadas com setas; direita lista os 7 princípios em itens numerados.)_

**Coluna esquerda — Stack arquitetural (de cima para baixo):**

```
┌──────────────────────────────────────────────────────────────────┐
│  CAMADA 4 // DECISÃO       Onde o operador age                   │
│                            gateway (TS) · ui (Next.js) · Grafana │
├──────────────────────────────────────────────────────────────────┤
│  CAMADA 3 // AGENTE LLM    Quem reformata o sinal em ação        │
│                            agent (Python+LangGraph) · RAG · guardrails │
├──────────────────────────────────────────────────────────────────┤
│  CAMADA 2 // INTELIGÊNCIA  Onde os modelos pontuam               │
│                            model-serving · burst-detector        │
├──────────────────────────────────────────────────────────────────┤
│  CAMADA 1 // DADOS         Onde tudo é capturado                 │
│                            Kafka · MinIO · ClickHouse            │
└──────────────────────────────────────────────────────────────────┘
                           ▲
                Fontes: ITSM · Status Page · Prometheus
```

**Coluna direita — 7 princípios que guiaram cada escolha:**

1. **Contratos antes de componentes.** Trocar Prophet por NeuralProphet ou Claude por GPT não quebra nada além daquele componente.
2. **K8s-nativo.** Toda a stack se descreve com 4 primitivas: `Deployment`, `StatefulSet`, `CronJob`, `Job`.
3. **Estado fora dos serviços.** Deployments stateless escalam via HPA; estado em Postgres/MinIO/ClickHouse/Kafka/Redis.
4. **Volume de produção.** ClickHouse + Kafka + Argo desde o desenho — centenas de milhares de eventos/dia, 24×7.
5. **Observabilidade dia 1.** Prometheus, Grafana, Loki, Tempo, Langfuse para LLM.
6. **Cloud-agnostic.** Roda em qualquer K8s 1.28+ (on-prem Locaweb, EKS/GKE/AKS, híbrido).
7. **Stack poliglota.** Camada externa em TS (`gateway`, `ui`); core de ML em Python (`model-serving`, `agent`, `burst-detector`).

## **SLIDE 8: Camada 1 — Dados**

_(Dica visual: tabela `Componente · Tecnologia · Primitiva K8s · Papel` + callout âmbar com 3 justificativas no rodapé.)_

| Componente | Tecnologia | Primitiva | Papel |
| :--- | :--- | :--- | :--- |
| **Barramento de eventos** | Apache Kafka (Strimzi) | `StatefulSet` | Stream near-real-time para Camadas 2 e 3 |
| **Ingestão batch** | Airbyte + scripts Python | `CronJob` + `Deployment` | Bootstrap histórico + fontes sem webhook |
| **Lake** | MinIO + Apache Iceberg | `StatefulSet` | Parquet particionado + time travel auditável |
| **Warehouse analítico** | ClickHouse (Altinity) | `StatefulSet` | Analítica em escala — bilhões de linhas em segundos |
| **Transformação** | dbt-core (`dbt-clickhouse` / `dbt-trino`) | `Job` (via Argo) | staging → intermediate → marts, SQL versionado |
| **Orquestração** | Argo Workflows | CRDs nativos K8s | DAGs como YAML — extensão do K8s, não sistema paralelo |
| **Qualidade** | Great Expectations | `Job` | Bloqueia DAG antes de contaminar warehouse |

**Callout — Por que não Postgres / Airflow / fila simples?**
- **ClickHouse > Postgres/DuckDB** — regime operacional é centenas de milhares de eventos/dia.
- **Argo > Airflow/Prefect** — extensão do K8s (mesma operação que o resto da stack: kubectl + GitOps + Prometheus).
- **Kafka > fila simples** — fluxo é streaming por natureza, exige replay e desacoplamento entre camadas.

## **SLIDE 9: Camada 2 — Inteligência (ML)**

_(Dica visual: grid de 3 model-cards (ícone + algoritmo + justificativa + métricas) + faixa verde "ops-stack" no rodapé.)_

| Modelo | Algoritmo | Por que essa escolha | Métricas |
| :--- | :--- | :--- | :--- |
| **Volume D+1 / D+7** (`fa-chart-line`) | LightGBM (lags 1·7·14d, Fourier) + Prophet baseline | LightGBM captura features heterogêneas; Prophet faz **sanity-check de sazonalidade**. Ensemble por média ponderada. | MAPE · IC 80% · MAE |
| **Risco de breach** (`fa-triangle-exclamation`) | LightGBM binário + isotonic + SHAP | Boosting captura interações não-lineares; isotonic corrige distorção de `class_weight` em 1% de positivos. | AUC-PR · Brier · recall@top-k/h |
| **Detecção de rajada** (`fa-bolt`) | z-score robusto (mediana+MAD) + CUSUM por IC | Sem treino — **zero overfit**, atualiza online, limiar adaptativo evita falso positivo em ICs ruidosos. | Precision · lead-time · FP/IC |

**Stack de operação dos modelos (faixa verde):**
- **MLflow** — tracking + registry (`staging → production` via API)
- **Feast** — feature store (mesma definição em batch e online)
- **`model-serving`** (FastAPI + BentoML) — `/predict/volume`, `/predict/breach`
- **`burst-detector`** — worker Kafka, estado por IC em Redis
- **Evidently AI** — drift via PSI/KS → métrica Prometheus → alerta Grafana

## **SLIDE 10: Camada 3 — Agente LLM**

_(Dica visual: tabela `Componente · Tecnologia · Papel` no topo + bloco-callout no rodapé (border-left vermelha) com as 6 tool-pills.)_

| Componente | Tecnologia | Papel |
| :--- | :--- | :--- |
| **Serviço (`agent`)** | FastAPI + LangGraph | API HTTP que orquestra o agente como grafo de estados |
| **Gateway LLM** | LiteLLM (Deployment) | LLM-agnostic — proxy único entre o agente e qualquer provider |
| **Modelo default** | Claude Sonnet 4.6 | Default em produção, com fallback para GPT-4.1 se o provider cair |
| **RAG** | pgvector (Postgres) + sentence-transformers PT-BR | Embeddings + filtros estruturados na **mesma query SQL** |
| **Validação** | Pydantic + JSON Schema | Saída inválida → retry → fallback `agent_failed=true` |
| **Auditoria** | Tabela `agent_calls` + Langfuse | Cada chamada do agente fica gravada e rastreável |

**Bloco-callout no rodapé** (border-left vermelha): _6 ferramentas (function calling) disponíveis ao agente —_
`get_recent_incidents` · `get_group_load` · `find_similar_resolved` · `get_ola_window` · `detect_backbone_pattern` · `get_breach_score`

## **SLIDE 11: Camada 4 — Interfaces (Webhook-first)**

_(Dica visual: 3 colunas iface-col (Slack, ui, Grafana) no topo + tabela de componentes técnicos no meio + banner-callout de princípio no rodapé (alinhado com Camadas 1, 2 e 3).)_

**3 colunas com ícone + label + título + descrição (topo):**

| Onde | Componente | Descrição |
| :--- | :--- | :--- |
| **Onde o operador age** | Slack / OpsGenie | Block Kit interativo com Ack & Aplicar, Ignorar, Escalar. Fan-out feito pelo `gateway`. |
| **Onde consulta panorama** | `ui` (Next.js) | Fila priorizada, drill-down SHAP, chat com agente. Auditabilidade total da decisão. |
| **Onde gestor vê tendência** | Grafana | Read-only — D+1/D+7, breaches vs. meta, carga por equipe. Adoção zero-fricção. |

**Tabela de componentes (descrição técnica, meio):**

| Componente | Tecnologia | Papel |
| :--- | :--- | :--- |
| **`gateway`** | TS + Fastify | Recebe e dispara webhooks do ITSM, manda alertas pro Slack/OpsGenie e expõe a API REST pública |
| **`ui`** | Next.js | Painel para o N1/N2 — fila priorizada e drill-down dos chamados em risco |
| **Painel tático** | Grafana (ClickHouse + Postgres) | Projeção D+1/D+7, breaches vs. meta, carga por equipe |
| **Autenticação** | Keycloak | SSO AD/LDAP |

**Banner-callout no rodapé** (border-left vermelha): **Princípio:** o operador não vai abandonar Slack/OpsGenie/ServiceNow. A interação real acontece **nos canais que ele já usa**. O painel é visão consolidada e auditoria, não centro de operação.

## **SLIDE 12: Infraestrutura — Tudo K8s, 4 primitivas**

_(Dica visual: tabela "tipo de carga → primitiva K8s → exemplos" + faixa de 6 ícones com componentes de infra no rodapé.)_

| Tipo de carga | Primitiva | Exemplos |
| :--- | :--- | :--- |
| Serviço de longa duração com tráfego | `Deployment` + `Service` + `Ingress` | `gateway` (TS+Fastify), `ui` (Next.js), `model-serving`, `agent`, Grafana, MLflow, LiteLLM, Langfuse |
| Serviço com estado persistente | `StatefulSet` + `PVC` | Postgres (pgvector), MinIO, ClickHouse, Kafka, Redis |
| Tarefa agendada | `CronJob` | Ingestão diária, retreino semanal, snapshot Feast, backup |
| Tarefa pontual | `Job` (via Argo) | `dbt run`, inferência batch, backfill |
| Coleta em todos os nós | `DaemonSet` | Promtail (Loki), node-exporter |

**Faixa de infra (6 itens com ícone):**
- **GitOps** — ArgoCD (rollback = `git revert`)
- **Service mesh** — Linkerd (mTLS automático)
- **Observabilidade** — Prometheus + Loki + Tempo
- **Secrets** — External Secrets + Vault
- **Backup** — Velero (RTO < 4h · RPO < 24h)
- **Segregação** — Namespace + NetworkPolicy

## **SLIDE 13: Fluxo End-to-End de um alerta**

_(Dica visual: timeline vertical com 8 marcos (`T+0s`, `T+5s`, …, `T+?`), cada linha com tempo · evento · componente; banner SLI no rodapé.)_

| T | Evento | Componente |
| :--- | :--- | :--- |
| **T+0s** | Webhook do ITSM Locaweb chega | `gateway` → Kafka `incidents.raw` |
| **T+5s** | Stream processa, qualidade valida e materializa | Argo · GE · MinIO/Iceberg · ClickHouse |
| **T+10s** | Detector de rajada avalia janela móvel do IC | `burst-detector` (Kafka) + Redis |
| **T+46s** | Modelo de breach pontua → score 0,78 + SHAP top-5 | `model-serving` `/predict/breach` |
| **T+47s** | Agente é invocado, chama tools relevantes | `agent` · `find_similar_resolved` + 2 tools |
| **T+50s** | Agente emite JSON validado (Pydantic OK) | Postgres `recommendations` + Kafka |
| **T+51s** | Operador é notificado em Slack/OpsGenie | `gateway` fan-out + `ui` live |
| **T+?** | Operador age — clique alimenta avaliação | `gateway` `/actions/callback` → Kafka |

**Banner SLI:** **SLI alvo:** < 60s entre incidente aberto e recomendação na tela. Monitorado em Grafana.

## **SLIDE 14: Protótipos da Solução**

_(Dica visual: grid 2×2 de wf-cards — número, ícone, título, label "Significado", descrição.)_

### 14.1 — Recomendação no Slack/OpsGenie (interface primária)
**Significado:** o operador interage **onde já vive**. Block Kit do Slack com **Ack & Aplicar**, **Ignorar**, **Escalar**, **Ver no painel**. Mesmo conteúdo vai para OpsGenie como alert estruturado. **Nenhum operador precisa abrir o painel para agir.**

### 14.2 — Painel agregado N1/N2 (`ui` — Next.js)
**Significado:** fila ordenada por urgência **reavaliada pelo agente**, não pelo score puro. Cada item é o TL;DR — leitura primária em **5 segundos**. Drill-down (SHAP, janela móvel, log do agente) a um clique. Chat com o agente para perguntar "por que essa recomendação?".

### 14.3 — Painel tático (Grafana, gestores)
**Significado:** decisão de escala da próxima semana, identificação de ICs candidatos a **manutenção preventiva**, justificativa quantitativa de pedidos de capacidade. Read-only, sem botões. Grafana é o que a Locaweb já usa em infra — **adoção zero-fricção**.

### 14.4 — Drill-down auditável ("por que o agente disse isso?")
**Significado:** auditabilidade total — N2 sênior pode contestar ou confirmar; o feedback alimenta a **avaliação contínua do agente**. Mostra SHAP top-5, ferramentas chamadas com argumentos/resultados, janela móvel do IC.

## **SLIDE 15: Gerenciamento do Projeto — Scrum**

_(Dica visual: três scrum-boxes lado a lado — Time · Cadência · Ferramentas. Sem banner adicional.)_

**Time**

| Papel | Quem |
| :--- | :--- |
| Product Owner | Thiago Nunes (interface FIAP/Locaweb) |
| Scrum Master | Rotativo por sprint |
| Dev Team | Gustavo Neves · João Porto · Raphael Moraes · Samuel Gusman · Thiago Nunes |

**Cadência**

| Cerimônia | Frequência / Duração |
| :--- | :--- |
| Daily | 3×/sem · 15min |
| Sprint Planning | 1h |
| Sprint Review + Retro | 1h |
| Refinement | 30min |

**Ferramentas**
- **Board** — GitHub Projects (kanban: Backlog → To Do → In Progress → Review → Done)
- **Repositório** — GitHub, branches `feat/*`, PR review obrigatório
- **Documentação** — `docs/sprint-XX/` por sprint
- **Comunicação** — WhatsApp (sync curto) + GitHub Issues (assíncrono e rastreável)

## **SLIDE 16: Finalização**

_(Dica visual: headline grande centralizada + lead curto + linha de agradecimento ao centro. Slide minimalista de fechamento.)_

**Headline (grande, centralizada):** Da ideia ao **projeto executável**.

**Lead:** O BOPE deixa de apagar incêndio para ver o incidente antes dele acontecer.

**Linha de fechamento (centralizada):** **Obrigado!** — Equipe Super Datados · FIAP Enterprise Challenge 2026 · Locaweb
