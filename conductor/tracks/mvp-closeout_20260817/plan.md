# Implementation Plan: Fechamento do MVP (Camadas 3 e 4)

**Track ID:** mvp-closeout_20260817
**Spec:** [spec.md](./spec.md)
**Created:** 2026-08-17
**Status:** [ ] Not Started

## Overview

Seis fases, na ordem em que uma destrava a seguinte. Os achados de consistência vêm primeiro porque
o gate de CI protege todo o resto da track, e a decisão sobre o grafo de marts precisa estar tomada
antes de qualquer feature de leitura de mart entrar. Depois a infraestrutura do `ns: agent`, que é
pré-requisito das duas fases de copiloto. O painel vem antes do Slack porque o drill-down é o que o
blind review precisa enxergar. As duas evidências de fechamento vão na última fase, quando existe o
que medir.

`agent` e o painel seguem a convenção do repositório: pasta em `apps/<nome>/` com `chart/app.yaml`
declarando natureza e namespace, chart em `infra/charts/<nome>/` e `ArgoCD Application` em
`infra/apps/<nome>.yaml`. Nenhum script de `infra/scripts/` precisa de edição.

---

## Phase 1: Achados de consistência e gate de CI

Fase curta e de baixo risco que fecha as três pendências levantadas na revisão de 2026-08-17.

### Tasks

- [ ] 1.1: Comparar o grafo da seção 4.1 do `sprint-3-mvp.md` com os `ref()` reais dos sete marts e
      decidir de que lado está o erro — doc ou modelagem. Registrar a decisão e o porquê
- [ ] 1.2: Aplicar a correção do lado decidido em 1.1 (reescrever o grafo do doc, ou introduzir as
      dependências entre marts no dbt com os testes correspondentes)
- [ ] 1.3: Rodar os testes das apps em `.gitea/workflows/build.yaml` como gate, com o build falhando
      quando algum quebra — descoberta de apps por glob, sem lista hardcoded
- [ ] 1.4: Incluir `dbt test` no gate ou registrar por que ele fica de fora
- [ ] 1.5: Revisar as duas formulações defasadas do doc: o rótulo "demo sem webhook real" no diagrama
      da camada 1 e a tese da pergunta 1 da seção 3

### Verification

- [ ] Um teste quebrado de propósito reprova o build na esteira
- [ ] O grafo de marts do doc e os `ref()` do dbt contam a mesma história

---

## Phase 2: Infraestrutura do `ns: agent`

Estado que sobe junto com seu consumidor: o Postgres com pgvector só existe a partir desta track.

### Tasks

- [ ] 2.1: `ns: agent` em `infra/apps/namespaces.yaml`, com ResourceQuota e NetworkPolicy no padrão dos
      demais namespaces
- [ ] 2.2: Chart `infra/charts/agent-postgres` — Postgres com extensão pgvector
- [ ] 2.3: MLflow AI Gateway configurado no `ns: ml`, com a chave do provedor vinda do Vault
- [ ] 2.4: `ExternalSecret` do `agent` — todos os segredos do app numa key só do Vault
- [ ] 2.5: `ArgoCD Application` de cada chart novo, na sync-wave correta

### Verification

- [ ] `SELECT extversion FROM pg_extension WHERE extname = 'vector'` responde no Postgres do `ns: agent`
- [ ] Uma chamada de teste ao gateway retorna completion sem a chave aparecer em log ou manifesto
- [ ] ArgoCD reconciliando os charts novos sem drift

---

## Phase 3: RAG pgvector

Base de similaridade que o `find_similar_resolved` consulta.

### Tasks

- [ ] 3.1: Seleção dos incidentes elegíveis: `status != "Sem Intervenção"`, `duracao_segundos > 60`,
      resolução preenchida
- [ ] 3.2: Geração de embeddings com `all-MiniLM-L6-v2`
- [ ] 3.3: Índice HNSW no Postgres do `ns: agent`
- [ ] 3.4: Query única combinando similaridade de embedding e filtros estruturados (IC, prioridade)
- [ ] 3.5: `CronJob` semanal de reindexação incremental
- [ ] 3.6: Testes da seleção de elegíveis e da montagem da query

### Verification

- [ ] Recuperação em < 50ms com filtros combinados, medida sobre o índice populado
- [ ] Busca por um incidente conhecido traz similares plausíveis do mesmo domínio

---

## Phase 4: `agent` — LangGraph e três ferramentas

O serviço que responde a pergunta central do MVP: a recomendação é acionável?

### Tasks

- [ ] 4.1: App `apps/agent/` (Python + FastAPI, `workload: deployment`, `namespace: agent`)
- [ ] 4.2: Grafo LangGraph com os nós `plan_tools`, `execute_tools`, `generate_recommendation`,
      `validate_json`
- [ ] 4.3: `get_recent_incidents` — lê o mart `incidents_by_ic` no ClickHouse
- [ ] 4.4: `find_similar_resolved` — consome o índice da Fase 3
- [ ] 4.5: `get_ola_window` — cálculo determinístico a partir da prioridade e `aberto_em`
- [ ] 4.6: Schema Pydantic da recomendação: `incidente_id`, `acao_recomendada`, `criticidade`,
      `score_breach`, `justificativa`, `similares`
- [ ] 4.7: Retry com mensagem de correção (máx 2×) e fallback `agent_failed=true`
- [ ] 4.8: Consumer de `alerts.burst`; publica a recomendação em `recommendations`
- [ ] 4.9: Chamada ao `ml-model-serving` para o score de breach e o SHAP top-5 que entram no payload
- [ ] 4.10: Cache de prompt habilitado no gateway
- [ ] 4.11: Chart, `ArgoCD Application` e `ScaledObject` KEDA sobre o lag de `alerts.burst`
- [ ] 4.12: Testes do schema, do caminho de retry e do fallback com LLM mockado

### Verification

- [ ] Recomendação válida gerada para um alerta real, com as três ferramentas chamadas
- [ ] JSON inválido duas vezes cai no fallback e o alerta segue com `agent_failed=true`
- [ ] Réplicas escalam de zero conforme o lag de `alerts.burst`

---

## Phase 5: Camada 4 — painel N1/N2 e fan-out Slack

As duas interfaces de entrega. O painel substitui o nginx placeholder do `ui-frontend`.

### Tasks

- [ ] 5.1: App do painel em `apps/ui-frontend/` (Next.js, npm), substituindo o placeholder do chart
- [ ] 5.2: Fila de recomendações ordenada por criticidade, polling de 10s
- [ ] 5.3: Card com leitura primária em 5 segundos: IC, ação recomendada, score, janela OLA
- [ ] 5.4: Drill-down com SHAP top-5 em barra horizontal, ferramentas chamadas com argumentos e
      resultados, e incidentes similares
- [ ] 5.5: Filtros por prioridade e grupo designado
- [ ] 5.6: Botões "Aplicar" e "Ignorar" chamando o `ui-gateway`
- [ ] 5.7: Consumer de `recommendations` no `ui-gateway`, com fan-out Slack para criticidade ≥ 4
- [ ] 5.8: Block Kit com IC, grupo, score, ação e justificativa, mais os botões `Ack & Aplicar`,
      `Ignorar (motivo)` e `Ver no painel`
- [ ] 5.9: `POST /slack/actions` — valida HMAC, grava a ação e publica em `actions.taken`
- [ ] 5.10: Testes do consumer, da montagem do Block Kit e da validação de assinatura

### Verification

- [ ] Recomendação com criticidade ≥ 4 aparece em `#ops-ahead-alertas` com os três botões
- [ ] Clique registra a ação e publica em `actions.taken`
- [ ] Drill-down mostra SHAP e ferramentas para uma recomendação real

---

## Phase 6: Evidências de fechamento

As duas medições que a Sprint 3 cobra como evidência.

### Tasks

- [ ] 6.1: Selecionar 50 incidentes do lote ingerido com OLA em risco (score de breach > 0,5 ou rajada
      detectada)
- [ ] 6.2: Rodar o `agent` em cada um e salvar as recomendações geradas
- [ ] 6.3: Cada integrante avalia independentemente se a recomendação faz sentido no contexto
- [ ] 6.4: Calcular a concordância entre avaliadores e com a ação registrada no dataset
- [ ] 6.5: Mapear os padrões de divergência — viram stories de ferramentas na Sprint 4
- [ ] 6.6: Rodar o simulador com 20 incidentes distintos e medir T+0 até o Block Kit no Slack
- [ ] 6.7: Registrar mediana e p95, e identificar o step mais lento se a mediana passar de 60s
- [ ] 6.8: Documentar os dois resultados em `docs/insights/` e atualizar o `sprint-3-mvp.md`

### Verification

- [ ] Blind review concluído com concordância calculada e divergências mapeadas
- [ ] Mediana e p95 do E2E registrados sobre 20 execuções

---

## Final Verification

- [ ] Todos os acceptance criteria da spec atendidos
- [ ] Testes das apps novas verdes no gate de CI da Fase 1
- [ ] ArgoCD reconciliando os charts da track sem drift
- [ ] `docs/sprints/sprint-3-mvp.md` atualizado com os resultados reais
- [ ] PR mergeado em `main` com revisão

---

_Generated by Conductor. Tasks will be marked [~] in progress and [x] complete._
