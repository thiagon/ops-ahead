# Roadmap — Ops Ahead

Visão de produto inteiro, sem recorte por sprint. Lista o que precisa ser construído até o sistema rodar ponta a ponta com as quatro camadas da arquitetura da Sprint 2.

## Estado atual

A infraestrutura base está deployada via ArgoCD no overlay `dev`. Tudo em GitOps a partir de `infra/charts/` + `infra/apps/`.

| Namespace | Componentes em pé |
|-----------|-------------------|
| `ns: data` | Kafka (Strimzi), MinIO, ClickHouse (Altinity), Argo Workflows |
| `ns: ml` | MLflow + Postgres, Redis |
| `ns: ui` | gateway e ui como stubs nginx |
| `ns: infra` | ArgoCD, Prometheus, Loki, Promtail, Vault + ESO, Gitea |

## Decisões arquiteturais posteriores à Sprint 2

Dois ajustes em relação ao documento da Sprint 2 — incorporar quando atualizar o desenho.

- **MLflow AI Gateway no lugar do LiteLLM.** O MLflow lançou versão com gateway LLM-agnóstico equivalente. Como o MLflow já roda em `ns: ml` para tracking/registry, reaproveita. `ConfigMap` de troca de modelo passa a ser do MLflow.
- **pgvector entra junto com o `agent`.** Estado específico de serviço sobe na mesma track do consumidor. Componentes compartilhados (ClickHouse, Kafka, MinIO, MLflow Postgres, Redis em `ns: ml`) ficam na infra base.

## Tracks em ordem de caminho crítico

### 1. Pipeline de dados ponta a ponta

DAG Argo Workflows que transforma o CSV histórico e o stream em marts validados. Desbloqueia modelos e copiloto.

- Steps da DAG: `ingest → dbt-run → great-expectations → register-snapshot`
- 6 marts dbt sobre ClickHouse: `incidents_by_ic`, `p4_sequences_by_ci`, `first_touch_duration`, `priority_changes_log`, `daily_anomaly_features`, `kpi_monthly_state`
- Suite Great Expectations com bloqueio crítico (`incidente_id` único, `prioridade_codigo` no domínio, `aberto_em ≤ fechado_em`, contagem coerente com a origem)
- Simulador de stream (`scripts/stream_simulator.py --speed Nx`) — replay cronológico do CSV publicando em `incidents.received`

### 2. Modelos de volume e breach

Hipótese central do produto. Sem evidência de poder preditivo no dado real, o produto inteiro fica em xeque.

- **Volume D+1 / D+7** — LightGBM com lags 1/7/14d, médias móveis, Fourier semanal, feriado, hora. Prophet como baseline e sanity check. Ensemble por média ponderada.
- **Breach** — LightGBM binário, dataset filtrado para P1–P3 elegíveis ao KPI. Features de domínio: idade vs. OLA, tempo no primeiro grupo, precursor P4, abertura manual, carga do grupo. Calibração isotônica pós-treino, SHAP por inferência.
- Split temporal: treino até set/2025, validação out/2025, hold-out nov/2025–jan/2026.
- Registro em MLflow, promoção para `Production`, serving em `model-serving` (FastAPI) com `/predict/volume` e `/predict/breach`.

### 3. Burst-detector

Worker stateless que mantém estado por IC em Redis e detecta rajadas em near-real-time. Gatilho primário do copiloto.

- Consumer Kafka em `incidents.received`, grupo `burst-detector`
- Estado por IC em Redis: contagem por janela (15min/1h/6h), mediana e MAD histórico
- z-score robusto (limiar adaptativo por IC) + CUSUM bidirecional
- Publica em `alerts.burst` quando cruzou
- Deployment puro no `ns: ml`

### 4. Agent — copiloto IA

Track que sobe o `ns: agent` completo: estado, gateway e serviço.

- **Infra do `ns: agent`:** Postgres com pgvector habilitado, tabelas `agent_calls`, `recommendations`, `actions`. Integra com MLflow AI Gateway em `ns: ml`.
- **Serviço `agent`:** FastAPI + LangGraph. Grafo com nós `plan_tools`, `execute_tools`, `generate_recommendation`, `validate_json`. Retry com correção (máx 2×) e fallback `agent_failed=true`.
- **RAG pgvector:** embeddings (`all-MiniLM-L6-v2`) dos resolvidos com `status != "Sem Intervenção"` e `duracao_segundos > 60`. Índice HNSW. CronJob semanal de reindexação.
- **Ferramentas (9):** `get_recent_incidents`, `get_group_load`, `find_similar_resolved`, `get_ola_window`, `detect_backbone_pattern`, `get_breach_score`, `detect_p4_escalation`, `detect_external_event`, `get_kpi_projection`.
- Schema Pydantic da recomendação versionado em JSON Schema único, consumido pelo `gateway` (Zod) e UI.

### 5. Gateway e UI reais

Substitui os stubs nginx.

- **`gateway` (TS + Fastify):**
  - `POST /webhook/incidents` com validação HMAC, normalização, publish em `incidents.received`
  - Consumer de `recommendations` → fan-out por `Notifier` (Slack via Block Kit como primeira implementação; arquitetura aberta a OpsGenie/Teams/PagerDuty)
  - `POST /slack/actions` e `/actions/callback` (genérico) com HMAC, grava em Postgres, publica em `actions.taken`
  - API pública `/api/v1/*` com OpenAPI gerado dos schemas Zod
- **`ui` (Next.js):**
  - Fila de recomendações ordenada por criticidade (polling 10s)
  - Card com IC, grupo, ação, score, janela OLA
  - Drill-down: SHAP top-5, ferramentas chamadas com argumentos e resultados, incidentes similares
  - Filtros por prioridade e grupo
  - Chat com o copiloto

### 6. Refinamento final

Itens que dão acabamento ao produto sem alterar o fluxo principal.

- **Inteligência:** projeção KPI mensal por Monte Carlo (4 projeções PPR), Isolation Forest para evento externo, Feast (feature store), Evidently (drift)
- **Observabilidade e auditoria:** Langfuse (traces de LLM), Tempo + OpenTelemetry (tracing distribuído)
- **Plataforma:** Authentik (SSO contra AD/LDAP), Linkerd (mTLS + métricas L7), cert-manager + TLS real, Velero (backup), HPA por serviço
- **Decisão:** painel tático Grafana (gestores), notifiers adicionais (OpsGenie, Teams, PagerDuty)

## Critérios de "rodando ponta a ponta"

O sistema é considerado completo quando, simultaneamente:

- DAG completa executa sobre o `incidents.csv` (122.543 linhas) sem falha crítica
- AUC-PR do modelo de breach em hold-out temporal ≥ 0,60
- Simulador → Block Kit no Slack fecha em menos de 60s na mediana de 20 execuções
- Copiloto produz recomendação JSON-válida em pelo menos 95% dos alertas, com fallback nos demais
- ArgoCD reconciliando todos os namespaces sem drift
