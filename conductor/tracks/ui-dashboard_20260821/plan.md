# Implementation Plan: Dashboard — a camada gold vira tela

**Track ID:** ui-dashboard_20260821
**Spec:** [spec.md](./spec.md)
**Created:** 2026-08-21
**Status:** [~] In Progress

## Overview

De trás para frente: primeiro o dado que falta, depois o app que o lê.

As Fases 1 e 2 dão destino consultável às duas análises que hoje calculam e não gravam — sem isso a
tela do gestor nasce com metade dos painéis vazios. A Fase 3 monta o app. As Fases 4 e 5 constroem
as duas telas. A Fase 6 leva ao cluster.

Nenhuma fase depende de infraestrutura nova: o ClickHouse já está no ar, o `ml-trainer` já lê dele,
o chart `ui-frontend` já existe como stub.

## Phase 1: A projeção de KPI ganha tabela e alinha com a meta anual

`kpi_projection` projeta contra alvo de `settings` e grava só métrica no MLflow. Passa a ler a meta
de onde ela vive e a gravar o resultado onde a tela lê.

### Tasks

- [x] Task 1.1: Teste — a projeção lê `tenant_kpi_targets` por `kpi_group`, não `kpi_target_*` de settings
- [x] Task 1.2: `kpi_projection/data.py` passa a ler `gold_alert_kpi_achievement` e o seed, no grão `kpi_group`
- [x] Task 1.3: `DIMENSIONS` deixa de mapear `p2`/`p3` para `severity` e passa a `p1_p2`/`p3`
- [x] Task 1.4: A probabilidade projetada responde "qual faixa da banda ao fim do ano", contra `breached_ytd`
- [x] Task 1.5: Teste — a projeção grava uma linha por `tenant_id` × `as_of_date` × `kpi_group`
- [x] Task 1.6: Escrita em `gold_kpi_projection` (`MergeTree`, `order_by` pela chave de leitura), mantendo o log no MLflow
- [x] Task 1.7: Remover os `kpi_target_*` de `settings.py`, agora sem uso

### Verification

- [x] `uv run --package ops-ahead-ml-trainer pytest apps/ml-trainer/tests` passa
- [x] Uma execução da análise deixa linhas em `gold_kpi_projection`, legíveis por `SELECT`

## Phase 2: A previsão de volume ganha tabela

O modelo de volume prevê D+1 e D+7 no treino e não persiste a previsão em lugar consultável.

### Tasks

- [x] Task 2.1: Teste — a previsão grava uma linha por `target_date` × `priority_group` × `horizon`
- [x] Task 2.2: Escrita em `gold_volume_forecast` (`MergeTree`), com intervalo de predição junto do ponto
- [x] Task 2.3: A escrita acontece no fim do treino, na mesma execução que já calcula a previsão

### Verification

- [x] `uv run --package ops-ahead-ml-trainer pytest apps/ml-trainer/tests` passa
- [x] Uma execução do treino de volume deixa as duas horizontes em `gold_volume_forecast`

## Phase 3: O app existe e fala com o ClickHouse

Scaffolding do `apps/ui-frontend` e a camada de consulta, antes de qualquer tela.

### Tasks

- [x] Task 3.1: `apps/ui-frontend` — React Router 7 framework mode, Node 24, npm, Biome, vitest
- [x] Task 3.2: `app.yaml` (`workload: deployment`, `namespace: ui`) e `chart/values-dev.yaml`
- [x] Task 3.3: Configuração por URL única (`clickhouse_url`, `tenant_id`), no padrão do repositório
- [x] Task 3.4: Teste — o cliente ClickHouse roda só no servidor; nenhuma credencial chega ao bundle
- [x] Task 3.5: Cliente ClickHouse server-side, com as consultas tipadas por gold
- [x] Task 3.6: Rota de health e `/metrics`, no mesmo formato dos demais apps de `ns: ui`
- [x] Task 3.7: Tokens de cor e tipografia extraídos de `docs/presentations/`, com as fontes servidas pelo app

### Verification

- [x] `npm run test` e `npm run lint` passam em `apps/ui-frontend`
- [x] Build de produção gera o output standalone que o Dockerfile serve

## Phase 4: A tela do operador

A fila de incidentes vivos, ordenada pelo prazo que resta.

### Tasks

- [ ] Task 4.1: Teste — o loader lê `silver_alert_open`, ordenado por `due_at`
- [ ] Task 4.2: Loader da fila, com `consumed_ratio`, severidade vigente e reconhecimento
- [ ] Task 4.3: Tela da fila — o que está prestes a estourar aparece primeiro
- [ ] Task 4.4: Teste — o score de risco vem do `ml-model-serving` e falha aberta quando ele não responde
- [ ] Task 4.5: Score por incidente ao lado do `consumed_ratio`, sem substituí-lo
- [ ] Task 4.6: Detalhe da ocorrência — prazo vigente, marcos já cruzados, histórico de severidade

### Verification

- [ ] `npm run test` passa
- [ ] Com dado da Fase 6, a fila mostra ocorrências vivas na ordem correta

## Phase 5: A tela do gestor

O fechamento do mês contra a meta anual, e o que vem pela frente.

### Tasks

- [ ] Task 5.1: Teste — o painel de KPI lê `gold_alert_kpi_achievement`, por `kpi_group`
- [ ] Task 5.2: Realizado contra a banda anual cumulativa — `breached_ytd` e a faixa alcançada
- [ ] Task 5.3: Projeção de fechamento de `gold_kpi_projection`, com intervalo e probabilidade
- [ ] Task 5.4: Previsão D+1/D+7 de `gold_volume_forecast`
- [ ] Task 5.5: Tendência por categoria e produto de `gold_alert_category_trends`, P2 e P3 nunca colapsadas
- [ ] Task 5.6: Carga por grupo de `group_load_by_window` e recursos ruidosos das gold `monitor`

### Verification

- [ ] `npm run test` passa
- [ ] Todos os painéis têm número; nenhum depende de análise sem tabela

## Phase 6: Dado vivo e cluster

Sem ocorrência aberta não há linha em `silver_alert_open`, e a fila do operador não tem o que mostrar.

### Tasks

- [ ] Task 6.1: Publicar ocorrências vivas pelo contrato `incident-alert`, entrando pela ingestão normal
- [ ] Task 6.2: Cobrir os casos que as telas precisam exercitar — cada faixa de consumo de prazo, estouro, transição de severidade, aberto sem reconhecimento
- [ ] Task 6.3: Dockerfile e substituição do stub nginx em `infra/charts/ui-frontend`
- [ ] Task 6.4: Ingress e NetworkPolicy, no padrão dos demais serviços de `ns: ui`
- [ ] Task 6.5: Verificar no cluster — app sincronizado por ArgoCD, telas respondendo com dado real

### Verification

- [ ] As ocorrências publicadas aparecem em `silver_alert_open` com `due_at` e `consumed_ratio` corretos
- [ ] `kubectl get pods -n ui` mostra o app rodando, e as duas telas carregam pelo ingress

## Final Verification

- [ ] Todos os acceptance criteria da spec atendidos
- [ ] Testes passando em `ml-trainer`, `ui-frontend` e `scripts`
- [ ] Nenhuma credencial de banco no bundle servido ao navegador
- [ ] `conductor/tech-stack.md` atualizado — hoje registra Nuxt, Airflow e PySpark, nada disso existe
- [ ] Ready for review

---

_Generated by Conductor. Tasks will be marked [~] in progress and [x] complete._
