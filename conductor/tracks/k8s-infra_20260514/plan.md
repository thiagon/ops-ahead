# Implementation Plan: Infra K8s Base

**Track ID:** k8s-infra_20260514
**Spec:** [spec.md](./spec.md)
**Created:** 2026-05-14
**Status:** [~] In Progress

## Overview

Criar os Helm charts por namespace em ordem de dependência: primeiro os namespaces de estado (`data`, `ml`, `agent`), depois os de aplicação (`ui`) e por último o de plataforma (`infra`). Cada fase termina com `helm install` e health checks validados antes de avançar.

---

## Phase 1: Estrutura do repositório e namespace `ns: data`

Montar o esqueleto de diretórios e provisionar os componentes de maior complexidade — os operators Strimzi (Kafka) e Altinity (ClickHouse) e os StatefulSets de MinIO e Argo Workflows.

### Tasks

- [x] 1.1: Criar estrutura de diretórios: `infra/charts/`, `infra/overlays/dev/`, `infra/overlays/prod/`
- [x] 1.2: Chart `ns: data` — Kafka via Strimzi Operator
  - Instalar CRDs do Strimzi
  - `Kafka` CR com 1 broker (dev) / 3 brokers (prod)
  - `KafkaTopic` CRDs: `incidents.raw`, `incidents.scored`, `alerts.burst`, `recommendations`, `actions.taken`
  - `values.dev.yaml`: 1 broker, retenção 1h, storage 2Gi
- [x] 1.3: Chart `ns: data` — MinIO + Iceberg
  - MinIO StatefulSet modo standalone (dev) / distribuído (prod)
  - Bucket inicial `ops-ahead-lake` criado via Job de bootstrap
  - `values.dev.yaml`: 1 réplica, storage 5Gi
- [x] 1.4: Chart `ns: data` — ClickHouse via Altinity Operator
  - Instalar CRDs do Altinity
  - `ClickHouseInstallation` CR com 1 shard, 1 réplica (dev)
  - `values.dev.yaml`: storage 5Gi, sem réplicas de backup
- [x] 1.5: Chart `ns: data` — Argo Workflows
  - Controller + Server como Deployments
  - ServiceAccount com permissões para criar Pods no namespace
  - `values.dev.yaml`: sem autenticação (dev), 1 réplica

### Verification

- [ ] `helm install ops-ahead-data ./infra/charts/data -n data --create-namespace` sem erro
- [ ] Kafka broker em Running, tópicos criados via `kubectl get kafkatopics -n data`
- [ ] MinIO acessível via port-forward, bucket `ops-ahead-lake` existente
- [ ] ClickHouse respondendo a `SELECT 1`
- [ ] Argo Workflows UI acessível via port-forward

---

## Phase 2: Namespaces `ns: ml` e `ns: agent`

Provisionar os componentes de estado para modelos e copiloto.

### Tasks

- [x] 2.1: Chart `ns: ml` — MLflow + Postgres
  - Postgres StatefulSet (backend do MLflow)
  - MLflow Deployment apontando para o Postgres
  - `values.dev.yaml`: Postgres storage 2Gi, 1 réplica
- [x] 2.2: Chart `ns: ml` — Redis
  - Redis StatefulSet modo standalone (dev)
  - `values.dev.yaml`: storage 1Gi, sem autenticação (dev)
- [x] 2.3: Chart `ns: agent` — Postgres + pgvector
  - Postgres StatefulSet com extensão pgvector habilitada
  - Tabelas iniciais criadas via Job de migration: `agent_calls`, `recommendations`, `actions`
  - `values.dev.yaml`: storage 2Gi
- [x] 2.4: Chart `ns: agent` — LiteLLM proxy
  - Deployment com ConfigMap para modelo default (Claude Sonnet 4.6) e fallback (GPT-4.1)
  - Secret para API keys (valor placeholder no dev — documentar como preencher)
  - `values.dev.yaml`: 1 réplica, sem HPA

### Verification

- [ ] `helm install ops-ahead-ml ./infra/charts/ml -n ml --create-namespace` sem erro
- [ ] `helm install ops-ahead-agent ./infra/charts/agent -n agent --create-namespace` sem erro
- [ ] MLflow UI acessível via port-forward, sem erro de conexão com Postgres
- [ ] Redis respondendo a `PING`
- [ ] Postgres do agent com pgvector: `SELECT * FROM pg_extension WHERE extname = 'vector'` retorna linha
- [ ] LiteLLM proxy respondendo em `/health`

---

## Phase 3: Namespace `ns: ui` (stubs)

Provisionar os Deployments de aplicação como stubs — imagem mínima que responde em `/health`. O código real vem nas Tracks 6 e 7.

### Tasks

- [x] 3.1: Chart `ns: ui` — gateway (stub)
  - Deployment com imagem `nginx:alpine` respondendo em `/health`
  - Service + Ingress configurados (sem TLS no dev)
  - `values.dev.yaml`: 1 réplica
- [x] 3.2: Chart `ns: ui` — ui (stub)
  - Deployment com imagem `nginx:alpine` respondendo em `/health`
  - Service + Ingress configurados
  - `values.dev.yaml`: 1 réplica

### Verification

- [ ] `helm install ops-ahead-ui ./infra/charts/ui -n ui --create-namespace` sem erro
- [ ] `curl` nos endpoints `/health` do gateway e da ui retorna 200

---

## Phase 4: Namespace `ns: infra` — plataforma e observabilidade

Provisionar ArgoCD (GitOps), Prometheus, Loki e Grafana.

### Tasks

- [x] 4.1: Chart `ns: infra` — ArgoCD
  - Instalar via Helm chart oficial
  - `Application` CRD apontando para `infra/overlays/dev` na branch `main`
  - `values.dev.yaml`: 1 réplica por componente, sem SSO
- [x] 4.2: Chart `ns: infra` — Prometheus + kube-prometheus-stack
  - Prometheus StatefulSet + Alertmanager
  - ServiceMonitor para todos os namespaces do Ops Ahead
  - `values.dev.yaml`: retenção 24h, storage 2Gi
- [x] 4.3: Chart `ns: infra` — Loki + Promtail
  - Loki StatefulSet (modo single-binary no dev)
  - Promtail DaemonSet coletando logs de todos os Pods
  - `values.dev.yaml`: storage 2Gi
- [x] 4.4: Chart `ns: infra` — Grafana
  - Deployment com datasources pré-configurados (Prometheus + Loki)
  - Dashboard de infra básico (CPU, memória, status dos Pods por namespace)
  - `values.dev.yaml`: 1 réplica, sem autenticação (dev)

### Verification

- [ ] `helm install ops-ahead-infra ./infra/charts/infra -n infra --create-namespace` sem erro
- [ ] ArgoCD UI acessível, Application em estado `Synced`
- [ ] Prometheus scraping métricas de pelo menos um Pod por namespace
- [ ] Grafana com dados de Prometheus e Loki aparecendo nos datasources

---

## Phase 5: NetworkPolicy e overlay `dev` consolidado

Aplicar as políticas de rede e validar o overlay completo do zero.

### Tasks

- [ ] 5.1: NetworkPolicy por namespace
  - `ns: data`: aceita tráfego de `ns: ml` e `ns: agent`; bloqueia `ns: ui`
  - `ns: ml`: aceita de `ns: agent` e `ns: ui` (porta da API apenas); bloqueia acesso direto ao ClickHouse de fora de `ns: ml` e `ns: data`
  - `ns: agent`: aceita de `ns: ui`; acessa `ns: ml` (model-serving) e `ns: data` (ClickHouse)
  - `ns: ui`: acessa `ns: ml` e `ns: agent` apenas nas portas de API definidas
- [ ] 5.2: Overlay `dev` consolidado em `infra/overlays/dev/kustomization.yaml`
  - Referencia todos os charts com `values.dev.yaml`
  - `README.md` com passo a passo: pré-requisitos, `helm install` por namespace, validação
- [ ] 5.3: Teste de instalação limpa
  - Apagar o namespace `ops-ahead-*` inteiro
  - Seguir o README do zero em k3s limpo
  - Confirmar que nenhum passo manual foi necessário além do documentado

### Verification

- [ ] NetworkPolicy validada: Pod em `ns: ui` não consegue abrir conexão direta com ClickHouse em `ns: data`
- [ ] Instalação limpa do zero sem erro seguindo apenas o README
- [ ] Todos os StatefulSets com `READY` antes de declarar a track concluída

---

## Final Verification

- [ ] Todos os acceptance criteria da spec atendidos
- [ ] README de deploy revisado por outro membro do time
- [ ] ArgoCD reconciliando após merge na `main`
- [ ] Nenhum segredo real commitado (API keys como placeholder documentadas)

---

_Generated by Conductor. Tasks marcadas [~] em progresso e [x] concluídas._
