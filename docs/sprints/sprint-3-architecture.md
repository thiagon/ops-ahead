# Sprint 3 — Arquitetura Real (MVP)

## Nome do Projeto

**Ops Ahead** — operação à frente, visão antecipada.

---

## 1. Por que este documento existe

`docs/sprints/sprint-2-architecture.md` desenhou a arquitetura **antes de qualquer linha de
implementação**. Ao longo da Sprint 3 esse desenho mudou em pontos estruturais — não por
desvio de rumo, mas porque a implementação revelou riscos e simplificações que o desenho de
papel não via. Este documento descreve o que **de fato roda hoje**: os 9 apps implementados,
os contratos, os tópicos com tráfego real, o que foi cortado do desenho original e por quê, e
o que ficou desenhado mas não construído.

Este não substitui o `sprint-2-architecture.md` — aquele registra a intenção original e o
raciocínio por trás de cada escolha inicial; este registra o resultado. Onde os dois
divergem, este documento é a fonte da verdade.

---

## 2. Visão Geral da Arquitetura Real

A solução continua modular em camadas, mas a **Camada 3 (Copiloto IA) ainda não foi
construída** — não por corte, e sim porque seu escopo nunca esteve dentro da Sprint 3: é
trabalho planejado para a Sprint 4, e a arquitetura das camadas 1, 2 e 4 já reserva o lugar
dela (tópicos, contratos, pontos de integração) para que a implementação futura seja aditiva.
As Camadas 1, 2 e 4 estão implementadas e rodando, com peças trocadas em relação ao desenho
original.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                       CAMADA 4 — DECISÃO (ns: ui)                              │
│  ui-gateway (intake HTTP)  ·  ui-orchestrator (REST/MCP → Kafka)               │
│  ui-frontend (React Router 7 — Painel N1/N2 · Painel Gestor · Fila)            │
└────────────────────────────────────────────────────────────────────────────────┘
                ▲ HTTP síncrono (predict/breach, predict/volume)
                │
┌───────────────┴──────────────────────────────────────────────────────────────┐
│                    CAMADA 2 — INTELIGÊNCIA (ns: ml)                          │
│  ml-trainer (5 análises: volume, breach, kpi_projection,                     │
│              external_event_detection, drift_monitoring)                     │
│  ml-model-serving (BentoML: /predict/volume, /predict/breach + SHAP)         │
│  ml-burst-detector (consumer events.monitor → z-score/CUSUM → alerts.burst)  │
│  MLflow (tracking + registry) · Postgres · Redis (estado do burst-detector)  │
└───────────────────────────────────────────────────────────────────────────────┘
                ▲ events.alert / events.monitor · deadlines.milestone
                │
┌───────────────┴───────────────────────────────────────────────────────────────┐
│                     CAMADA 1 — DADOS (ns: data)                              │
│  data-ingest (consumer + estágio de tradução: lake → bronze → events.*)      │
│  data-runner (dbt staging→marts→silver→gold + Great Expectations)           │
│  data-deadline-tracker (marcos de OLA sobre incidents abertos)              │
│  ClickHouse (Altinity) · MinIO (lake Parquet) · Kafka (Strimzi)             │
└───────────────────────────────────────────────────────────────────────────────┘
                                       ▲
                                       │ webhook HTTP assinado (HMAC)
                            ITSM Locaweb (fonte externa)
```

**O que ainda não entrou, por planejamento (não por corte):** Camada 3 inteira
(Copiloto/`agent`, LangGraph, RAG via pgvector) — reservada para a Sprint 4. Ver seção 6.

**O que foi de fato cortado do desenho original** — construído ou especificado, e depois
removido: Argo Workflows, Airbyte, Prefect, Keycloak, LiteLLM, Linkerd, Trino, Feast,
Langfuse. Ver seção 5.

**O que ficou igual:** separação em `Deployment`/`StatefulSet`/`CronJob`, GitOps via ArgoCD,
Kafka como barramento, ClickHouse como warehouse, MinIO como lake, contratos versionados como
fronteira entre camadas.

---

## 3. Componentes Reais por Camada

### 3.1 Camada 1 — Dados (`ns: data`)

| App/Componente | Natureza | Papel real |
|---|---|---|
| **ui-gateway** *(ns: ui, mas é a fronteira de entrada da Camada 1)* | `deployment` | Uma rota HTTP por credencial `(tenant, source)`. Valida HMAC, nunca interpreta o corpo, publica `EventEnvelope` em `events.raw.alert` ou `events.raw.monitor` conforme o `intake` da credencial. Responde `202` — o barramento passa a ser dono do evento. |
| **data-ingest** | `deployment` + KEDA `ScaledObject` (kafka, min 0 / max 5) | Consumer de `events.raw.alert`, `events.raw.monitor` e `deadlines.milestone`. É simultaneamente o **estágio de tradução** — não existe app separado para isso. Por mensagem: grava o envelope cru em Parquet no MinIO (lake, incondicional, antes de qualquer interpretação) → traduz via dicionário versionado por `(tenant_id, source)` → grava bronze no ClickHouse (`bronze_alert`/`bronze_monitor`/`bronze_deadline_milestone`) → publica o evento traduzido em `events.alert`/`events.monitor`. Hoje só o adapter de alert do ITSM está implementado (`_MONITOR_ADAPTERS` vazio) — tradução de monitor é débito em aberto. |
| **data-runner** | `deployment` + KEDA `ScaledObject` (kafka) para o modo `consume`; **CronJob nativo** no mesmo chart (`0 2 * * *` UTC) para a cadeia diária | Consumer de `trigger.data`. Roda dbt (staging → marts → silver → gold sobre ClickHouse) + suíte Great Expectations (`critical`) + `register_snapshot`, em sequência dentro do handler — não é um Argo Workflow, é código sequencial. O CronJob publica `{"run_id": "daily-<date>", "analysis": "full_pipeline"}` em `trigger.data`; esse valor de `analysis` nunca é aceito via `POST /trigger`. |
| **data-deadline-tracker** | `deployment` (sempre ativo, sem KEDA) | Consumer de `events.alert`. Rehidrata do ClickHouse, no startup, o estado de incidentes abertos elegíveis. Tick periódico recalcula o prazo consumido e publica marcos (`pct_25/50/75/100/abandoned`) em `deadlines.milestone` quando cruzados. |
| **ClickHouse** (Altinity Operator) | `StatefulSet` | Warehouse. Camadas dbt: `staging` → `marts` (8 modelos) → `silver` (`silver_alert`, `silver_alert_open`, `silver_monitor`) → `gold` (10 modelos). |
| **MinIO** | `StatefulSet` | Lake em Parquet, particionado por `tenant/intake/source/date`. Continua existindo exatamente como a Sprint 2 desenhava — não houve mudança aqui. |
| **Kafka** (Strimzi Operator) | `StatefulSet` (brokers) + CRDs `KafkaTopic` | 11 tópicos provisionados; nem todos com tráfego (ver seção 4). |

**Marts e golds reais** (substituem a lista especulativa da Sprint 2):

| Camada | Modelos |
|---|---|
| `marts` | `incidents_by_ic`, `first_touch_duration`, `group_load_by_window`, `kpi_monthly_state`, `priority_changes_log`, `breach_training_examples`, `candidate_open`, `no_intervention_sequences_by_ci` |
| `silver` | `silver_alert`, `silver_alert_open`, `silver_monitor` |
| `gold` | `gold_alert_breach_consolidation`, `gold_alert_category_entity_breakdown`, `gold_alert_category_trends`, `gold_alert_daily_features`, `gold_alert_kpi_achievement`, `gold_kpi_projection`*, `gold_volume_forecast`*, `gold_monitor_auto_resolution_rate`, `gold_monitor_daily_features`, `gold_monitor_severity_escalations`, `gold_monitor_signal_counts`, `gold_monitor_signal_intervals` |

\* `gold_kpi_projection` e `gold_volume_forecast` são escritos pelo `ml-trainer`, não pelo dbt — ficam na camada gold por convenção de consumo, não de origem.

### 3.2 Camada 2 — Inteligência (`ns: ml`)

| App/Componente | Natureza | Papel real |
|---|---|---|
| **ml-trainer** | `deployment` + KEDA `ScaledObject` (kafka) | Consumer de `trigger.ml`. Cobre 5 análises, cada uma com módulo próprio — ver tabela de modelos abaixo. Registra em MLflow, publica status em `trigger.status`. |
| **ml-model-serving** | `deployment` + **HPA** (CPU/memória — não KEDA, é API síncrona) | BentoML. Carrega modelos `Production` do MLflow Registry no startup. Expõe `POST /predict/volume` e `POST /predict/breach` (com SHAP top-5). A/B entre versões por header `x-model-version`. Serve só 2 das 5 análises — kpi_projection, external_event_detection e drift_monitoring nunca viraram endpoint (decisão explícita, adiada para Sprint 4). |
| **ml-burst-detector** | `deployment` + KEDA `ScaledObject` (kafka) | Consumer de `events.monitor`. Estado por `entity_id`/janela em Redis (contagem, mediana, MAD). Calcula z-score robusto + CUSUM bidirecional, publica `BurstAlert` (`spike`/`regime_change`) em `alerts.burst`. |
| **MLflow** | `deployment` + Postgres `StatefulSet` | Tracking + registry padrão. Sem gateway LLM configurado — não há LLM a servir enquanto o Copiloto não existir (ver seção 5). |
| **Redis** | `StatefulSet` | Estado do burst-detector (janelas, contadores). |

**Modelos reais implementados** (todos em `apps/ml-trainer/src/`):

| `analysis` | Técnica | Observações |
|---|---|---|
| `volume_forecast` | Prophet por série + LightGBM, ensemble por peso ótimo | Escreve `gold_volume_forecast` (D+1/D+7). Confirma o desenho original da Sprint 2. |
| `breach_risk` | LightGBM binário + Optuna (tuning) + calibração isotônica + SHAP top-5 | Inclui features de recategorização (`priority_changes_log`). Vai além do desenho original (Optuna não estava previsto). |
| `kpi_projection` | Monte Carlo + LightGBM residual (forecast recursivo) | Projeta contra `tenant_kpi_targets` por `kpi_group` (`p1_p2`/`p3`). Escreve `gold_kpi_projection`. |
| `external_event_detection` | Isolation Forest | Sobre `gold_monitor_daily_features`. Confirma o desenho original. |
| `drift_monitoring` | Evidently AI (PSI/KS por feature) | Compara janela de referência (registrada no MLflow) vs. janela atual. **Gap de contrato**: não está listado em `contracts/trigger-ml.schema.json` nem em `domain/ubiquitous-language.md#analysis` — pendência de documentação a fechar. |

### 3.3 Camada 4 — Decisão (`ns: ui`)

| App/Componente | Natureza | Papel real |
|---|---|---|
| **ui-gateway** | `deployment` | Ver seção 3.1 — é fronteira de entrada, mas fica no namespace `ui` por convenção de time (fronteira HTTP externa). |
| **ui-orchestrator** | `deployment` | REST + MCP. `POST /trigger` valida payload (Zod, discriminado por `analysis`), publica em `trigger.ml` ou `trigger.data`, responde `202 {run_id}`. `GET /runs/{run_id}` lê de um mapa em memória rehidratado de `trigger.status` no startup. Nunca toca a API do Kubernetes. Consumer group **sempre novo por boot** (nunca fixo) — é o que garante replay integral do backlog de `trigger.status` a cada restart, ao custo de nunca dividir partições entre réplicas (aceitável: é leitura de estado, não processamento de fila). |
| **ui-frontend** | `deployment` | React Router 7 (framework mode), loaders server-side. Rotas: `/` (**Painel N1/N2** — fila priorizada, drill-down com SHAP, incidentes similares, padrões recorrentes), `/painel-gestor` (visão tática, ex-`dashboard.tsx`), `/fila`, `/ocorrencias/:source/:externalId` (+`/detalhe`), `/health`, `/metrics`. Loaders leem ClickHouse direto (nunca expõem credencial ao navegador) e chamam `ml-model-serving` via HTTP síncrono para `breach_probability` + SHAP (fail-open se o serviço não responder). **Nunca fala com Kafka, MLflow ou LLM.** |

O Painel N1/N2 é a peça que a Sprint 2 desenhava como parte da Camada 4 e que ficou pendente
por duas sprints — foi implementado nesta Sprint 3 (`ui-dashboard_20260821`, commit `f8fc1b0`)
como tela inicial (landing screen), substituindo a antiga tela única por três rotas
especializadas.

---

## 4. Barramento de Eventos — Tópicos Reais vs. Reservados

| Tópico | Produtor → Consumidor | Status |
|---|---|---|
| `events.raw.alert` / `events.raw.monitor` | ui-gateway → data-ingest | **Tráfego real** |
| `events.alert` / `events.monitor` | data-ingest → data-deadline-tracker, ml-burst-detector | **Tráfego real** |
| `deadlines.milestone` | data-deadline-tracker → data-ingest (bronze) | **Tráfego real** (novo desde `incident-flow_20260819`, substitui `incidents.received` sem alias) |
| `alerts.burst` | ml-burst-detector → *(Copiloto, quando existir)* | **Tráfego real** produzido, sem consumidor de negócio hoje |
| `trigger.ml` / `trigger.data` | ui-orchestrator → ml-trainer / data-runner | **Tráfego real** |
| `trigger.status` | ml-trainer / data-runner → ui-orchestrator | **Tráfego real**, compactado por `run_id` |
| `incidents.scored` | *(Predição → Copiloto)* | **Reservado, sem tráfego** |
| `recommendations` | *(Copiloto → Integração)* | **Reservado, sem tráfego** |
| `actions.taken` | *(Integração → Acervo)* | **Reservado, sem tráfego** |

Reservar o tópico antes de ter produtor/consumidor é deliberado — é o que deixa os contextos
livres para serem implementados em qualquer ordem, sem renegociar nomes depois (ver
`domain/context-map.md`).

---

## 5. O que Foi Cortado do Desenho da Sprint 2

Esta seção cobre peças que **foram construídas ou especificadas** durante a Sprint 3 e depois
**removidas** — corte real, decidido durante a implementação. O Copiloto IA não está aqui: ele
nunca chegou a ser especificado nesta sprint, é trabalho planejado para a Sprint 4 (seção 6).

| Peça (Sprint 2) | Situação real | Motivo |
|---|---|---|
| **Argo Workflows** | Cortado por completo, junto com `infra/charts/data-workflows` e `ml-workflow-template` | Qualquer processo de app com permissão de criar recurso Kubernetes (mesmo um `Sensor` do Argo) foi considerado risco de segurança inaceitável. Substituído por KEDA `ScaledObject` — peça de plataforma, instalada uma vez, nunca acionada por código de aplicação — mais Kafka para desacoplamento e `CronJob` nativo para agendamento. |
| **`ScaledJob`** (mencionado na spec da track que fez esse corte) | Também descartado, em favor de `ScaledObject` escalando um `Deployment` | Um `Job` minter por mensagem não tem dono que sobreviva ao controller que o gerencia — pode vazar indefinidamente se esse controller for descomissionado. `ScaledObject` escala réplicas de um consumer de vida longa, incluindo até zero quando ocioso. |
| **Airbyte** | Nunca implementado | Ingestão real é 100% webhook HTTP (`ui-gateway`) + Kafka. Não há necessidade de bootstrap batch separado no fluxo atual. |
| **Prefect** | Nunca implementado | Já descartado na própria Sprint 2 em favor de Argo Workflows, que por sua vez foi cortado depois. |
| **Keycloak** | Nunca implementado | Não há SSO hoje — proteção só por Ingress/NetworkPolicy. **Authentik** (não Keycloak) está registrado como pendência futura para Sprint 3/4 tardia, reaproveitando Postgres+Redis já existentes. |
| **LiteLLM** | Adiado, não cortado — depende do Copiloto (Sprint 4) | Decisão de roadmap já aponta **MLflow AI Gateway** como substituto de LiteLLM quando o Copiloto for construído — reaproveita o MLflow que já roda em `ns: ml`, sem novo componente. |
| **Linkerd** | Nunca implementado | Nenhum service mesh no cluster hoje. |
| **Trino** | Nunca implementado | Já era "evolução natural, fora do MVP" na própria Sprint 2. |
| **Feast** | Excluído do MVP, com justificativa registrada | Feature store dedicada não se paga no volume e na cardinalidade de features atuais do MVP. |
| **Langfuse** | Adiado, não cortado — depende do Copiloto (Sprint 4) | Auditoria de chamadas de LLM só faz sentido quando houver LLM chamando algo. |

**O que foi implementado além do que a Sprint 2 previa:**

- **BentoML + A/B por header + Evidently AI** — a Sprint 2 já cogitava essas três peças, um
  desvio para uma versão mais simples (FastAPI puro, sem A/B, sem monitoramento de drift) foi
  proposto durante a implementação e **recusado** — o time optou por manter as três como
  desenhado originalmente.
- **Optuna** para tuning do modelo de breach — não estava no desenho da Sprint 2.
- **`gold_volume_forecast`/`gold_kpi_projection`** como tabelas gold consumíveis pelo
  frontend, não só como métrica registrada no MLflow.

---

## 6. O Maior Gap Aberto: Copiloto IA, Planejado para a Sprint 4

O `domain/context-map.md` classifica o contexto **Copiloto** como *"previsto"* — a
arquitetura reserva o lugar (tópicos `incidents.scored`, `alerts.burst` como entrada,
`recommendations` como saída) e o ponto de integração existe, mas nenhuma implementação o
ocupa ainda. Isso é planejamento, não corte: diferente das peças da seção 5 — que chegaram a
ser construídas ou especificadas e foram removidas — o Copiloto nunca esteve no escopo da
Sprint 3. Reservar o lugar dele desde já é o que garante que construí-lo depois seja aditivo,
sem renegociar contrato ou tópico com as camadas já em produção.

A track `mvp-closeout`, que cobriria "Copiloto e painel N1/N2", ainda não foi criada — está
documentada como próximo passo explícito em `conductor/tracks/ui-dashboard_20260821/spec.md`
e `plan.md`. O painel N1/N2 foi entregue nesta sprint mesmo assim (Painel N1/N2 em
`ui-frontend`), com a peça do Copiloto marcada como pendência clara em vez de simulada — a
própria UI reflete isso ao vivo: a seção "ferramentas chamadas pelo copiloto" no drill-down
mostra o texto *"pendente — o agente de decisão ainda não existe"*, em vez de inventar dado.

**Consequência prática:** hoje o operador vê, no drill-down de uma ocorrência, o score de
breach (com SHAP), incidentes similares e o histórico de severidade/marcos — tudo calculado
direto do ClickHouse e do `ml-model-serving`. O que falta é a camada que combina esses sinais
em uma **recomendação de ação única e explicável** (ex.: "ESCALAR para N2 — motivo X, similar
Y, OLA expira em Z min"), que era o diferencial central do produto na ideação da Sprint 1.

**Débito técnico menor, independente do Copiloto, documentado em
`ui-dashboard_20260821/plan.md`:**

- 6 das 10 tabelas gold nunca viraram tela própria (`gold_monitor_severity_escalations`,
  `gold_monitor_signal_intervals`, `gold_monitor_auto_resolution_rate`,
  `gold_monitor_daily_features` usada só como feature interna, mais cobertura parcial de
  `gold_alert_daily_features` e `gold_alert_category_entity_breakdown`).
- Tradução de eventos de `monitor` no `data-ingest` (`_MONITOR_ADAPTERS` vazio) — hoje só
  `alert` do ITSM tem adapter implementado.
- `drift_monitoring` sem registro em `contracts/trigger-ml.schema.json` e em
  `domain/ubiquitous-language.md#analysis`.

**Roadmap para o Copiloto** (Sprint 4): `apps/agent` novo, `ns: agent`,
FastAPI + LangGraph orquestrando function calling, RAG via pgvector sobre Postgres já
existente, MLflow AI Gateway como camada de acesso a LLM (substituindo o LiteLLM do desenho
original), consumindo `alerts.burst`/`deadlines.milestone`/scores de `ml-model-serving` e
publicando em `recommendations` — os tópicos e contratos já reservados tornam essa
implementação aditiva, sem renegociar nada nas camadas existentes.

---

## 7. Diagrama de Implantação Real

```
┌─────────────────────── Cluster Kubernetes (k3d local) ────────────────────────────────┐
│                                                                                        │
│  ns: data                                                                             │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────────────────────┐    │
│  │ data-ingest  │  │ data-runner      │  │ data-deadline-tracker                │    │
│  │ Deployment + │  │ Deployment (KEDA)│  │ Deployment (sempre ativo)             │    │
│  │ KEDA         │  │ + CronJob nativo │  │                                       │    │
│  │ (lake+bronze+│  │ (dbt+GE+snapshot)│  │                                       │    │
│  │  tradução)   │  │                  │  │                                       │    │
│  └──────┬───────┘  └────────┬─────────┘  └───────────────┬───────────────────────┘    │
│         │                   │                            │                            │
│         ▼                   ▼                            ▼                            │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────────────────────┐    │
│  │ MinIO        │  │ ClickHouse       │  │ Kafka (Strimzi)                      │    │
│  │ StatefulSet  │  │ StatefulSet      │  │ StatefulSet — 11 tópicos             │    │
│  │ (lake Parquet│  │ (Altinity)       │  │                                       │    │
│  └──────────────┘  └──────────────────┘  └───────────────┬───────────────────────┘    │
│                                                            │                            │
│  ns: ml                                                    │                           │
│  ┌──────────────┐  ┌──────────────────┐  ┌─────────────────▼────────────────────┐    │
│  │ ml-model-    │  │ MLflow           │  │ ml-burst-detector (consumer Kafka)   │    │
│  │ serving      │  │ Deployment       │  │ Deployment + KEDA                    │    │
│  │ Deployment+  │  │ + Postgres SS    │  │ (z-score + CUSUM → alerts.burst)     │    │
│  │ HPA (BentoML)│  │                  │  │                                       │    │
│  └──────────────┘  └──────────────────┘  └──────────────────────────────────────┘    │
│  ┌──────────────┐                                                                      │
│  │ ml-trainer   │                                                                      │
│  │ Deployment + │                                                                      │
│  │ KEDA         │                                                                      │
│  │ (5 análises) │                                                                      │
│  └──────────────┘                                                                      │
│                                                                                        │
│  ns: ui                                                                               │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────────────────────┐    │
│  │ ui-gateway   │  │ ui-orchestrator  │  │ ui-frontend                          │    │
│  │ Deployment   │  │ Deployment       │  │ Deployment                           │    │
│  │ (webhook →   │  │ (REST+MCP →      │  │ (React Router 7 — Painel N1/N2,     │    │
│  │  events.raw) │  │  trigger.*)      │  │  Painel Gestor, Fila)                │    │
│  └──────────────┘  └──────────────────┘  └──────────────────────────────────────┘    │
│                                                                                        │
│  ns: infra                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────────────┐    │
│  │ ArgoCD · KEDA · Prometheus/Grafana/Alertmanager · Loki/Promtail (via chart   │    │
│  │ oficial, sem pasta própria) · Vault (+ unseal automation) · External Secrets │    │
│  │ Operator · Gitea + act-runner (CI)                                           │    │
│  └──────────────────────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────────────────────┘

                     ns: agent — planejado para a Sprint 4 (Copiloto IA)
```

Ingress real usa **Traefik** (não NGINX Ingress como a Sprint 2 supunha). Não há service mesh.

---

## 8. Fluxo End-to-End Real (Sequência de um Alerta)

1. **ITSM emite webhook.** `POST` para a rota específica de `(tenant, source)` no
   **ui-gateway**. HMAC validado, corpo nunca interpretado. Publica `EventEnvelope` em
   `events.raw.alert`. Resposta `202`.
2. **data-ingest consome e traduz.** Grava o envelope cru em Parquet no MinIO
   (incondicional). Traduz via dicionário `(tenant_id, source)`. Grava `bronze_alert` no
   ClickHouse. Publica o evento traduzido (`IncidentAlert`) em `events.alert`.
3. **data-deadline-tracker reage.** Consome `events.alert`, atualiza estado de incidentes
   abertos, calcula prazo consumido a cada tick. Ao cruzar 25/50/75/100% do OLA (ou
   abandono), publica em `deadlines.milestone`.
4. **data-runner processa em lote (assíncrono, não no caminho do alerta individual).** O
   CronJob diário (ou um `POST /trigger` manual via ui-orchestrator) dispara dbt → Great
   Expectations → snapshot, atualizando marts/silver/gold que alimentam treino e o frontend.
5. **Operador abre o Painel N1/N2.** O loader de `ui-frontend` lê `silver_alert_open` do
   ClickHouse, chama `POST /predict/breach` no `ml-model-serving` (síncrono, fail-open) para
   obter `breach_probability` + SHAP top-5, monta a fila ordenada por criticidade.
6. **Drill-down de uma ocorrência.** Busca marcos de OLA, histórico de severidade e
   incidentes similares (via `gold_alert_breach_consolidation`) — tudo do ClickHouse. A seção
   de "ferramentas chamadas pelo copiloto" mostra pendência explícita: o Copiloto não existe.
7. **Sem passo 7.** Não há recomendação automática, não há fan-out para Slack/OpsGenie, não
   há `actions.taken`. O operador decide e age fora do sistema — o ciclo de avaliação do
   Copiloto (que dependeria de `actions.taken`) não roda.

**Contraste com o fluxo desenhado na Sprint 2:** os passos 1-4 acontecem como previsto
(ingestão → tradução → marts → detecção). Os passos 5-8 do desenho original (score de breach
→ Copiloto invocado → JSON validado → notificação em Slack/OpsGenie) colapsam nos passos 5-6
reais: o operador vê o score e o contexto, mas a etapa de síntese em recomendação não roda —
é consulta, não decisão assistida.

**Ramificação que funciona hoje:** rajada em `events.monitor`. O **ml-burst-detector**
consome, mantém estado por entidade em Redis, calcula z-score + CUSUM, publica em
`alerts.burst` quando cruza o limiar — mas esse tópico não tem consumidor de negócio hoje
(reservado para o Copiloto).

**Execução sob demanda (fora do caminho do alerta):** um operador ou agente de IA externo
chama `POST /trigger` no `ui-orchestrator` pedindo `volume_forecast`, `breach_risk`,
`kpi_projection`, `external_event_detection`, `drift_monitoring` (via `trigger.ml`) ou
`data_refresh`/`data_quality_check` (via `trigger.data`). Recebe um `run_id`, consulta
`GET /runs/{run_id}` até status terminal. Nunca cria recurso Kubernetes — quem escala os
consumers é KEDA, a partir do lag do tópico.

---

## 9. Estado dos Contratos

| Contrato | `$id` | Situação |
|---|---|---|
| `event-envelope.schema.json` | `event-envelope/v1` | Estável, em uso |
| `incident-alert.schema.json` | `incident-alert/v1` | Estável, em uso |
| `condition-monitor.schema.json` | `condition-monitor/v1` | Estável; adapter de tradução ainda não implementado no `data-ingest` |
| `deadline-milestone.schema.json` | `deadline-milestone/v1` | Estável, em uso (substitui `incidents.received` sem alias) |
| `translation-dictionary.schema.json` | `translation-dictionary/v1` | Estável, em uso |
| `trigger-ml.schema.json` | `trigger-ml/v1` | Em uso, mas **incompleto**: falta a variante `drift_monitoring`, que já roda em produção via `ml-trainer` |
| `trigger-data.schema.json` | `trigger-data/v1` | Estável, em uso |
| `trigger-status.schema.json` | `trigger-status/v1` | Estável, em uso |
| — (recomendação) | — | Nunca criado — não há schema porque não há Copiloto para produzir esse payload |

---

## 10. Próximos Passos (entrada da Sprint 4)

1. Fechar o gap de contrato do `drift_monitoring` em `contracts/trigger-ml.schema.json` e
   `domain/ubiquitous-language.md#analysis`.
2. Implementar o adapter de tradução de `monitor` no `data-ingest`
   (`_MONITOR_ADAPTERS`), hoje vazio.
3. Cobrir as 6 tabelas gold ociosas com tela própria ou justificar formalmente por que ficam
   como feature interna.
4. Abrir a track do Copiloto (`ns: agent`, FastAPI + LangGraph, MLflow AI Gateway, RAG via
   pgvector) — é o maior gap entre o produto prometido na Sprint 1 e o que está em produção.
5. Authentik SSO para `ui-frontend` e `ui-orchestrator`, reaproveitando Postgres+Redis já
   provisionados.

---

**Equipe Super Datados — FIAP Enterprise Challenge 2026 · Locaweb**

Gustavo Rodrigues Neves · João Gabriel Rodrigues Porto · Raphael Carlos da Silva Moraes · Samuel Calebe Gusman · Thiago Nunes Pereira
