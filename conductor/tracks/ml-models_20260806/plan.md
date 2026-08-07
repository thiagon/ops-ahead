# Implementation Plan: Modelos de ML (Camada 2 — Inteligência)

**Track ID:** ml-models_20260806
**Spec:** [spec.md](./spec.md)
**Created:** 2026-08-06
**Status:** [ ] Not Started

## Overview

Construir a Camada 2 em cinco fases, dos dois modelos treinados até a validação ponta a ponta. Volume e breach primeiro — são a hipótese central do MVP e não dependem um do outro, então podem ser implementados em paralelo por pessoas diferentes. `burst-detector` depois, porque é estatística pura e não depende de nenhum dos dois modelos. `model-serving` por último, porque só faz sentido expor artefatos já registrados no MLflow. A fase final mede os critérios do doc (AUC-PR, MAPE, lead-time) contra o dado real e documenta o resultado — é a evidência que a Sprint 3 exige.

Cada app novo segue a convenção do repositório: pasta em `apps/<nome>/` com `chart/app.yaml` declarando a natureza (`job` para os dois treinos, `deployment` para `burst-detector` e `model-serving`), chart correspondente em `infra/charts/<nome>/` e `ArgoCD Application` em `infra/apps/<nome>.yaml`. Nenhum script de `infra/scripts/` precisa de edição — todos descobrem apps por glob.

---

## Phase 1: Modelo de Volume (D+1 / D+7)

Primeiro modelo treinado e registrado no MLflow. Prophet como baseline/sanity-check, LightGBM como modelo principal.

### Tasks

- [x] 1.1: App `apps/ml-volume-model/` (Python, `workload: job` em `chart/app.yaml`, `namespace: ml`)
- [x] 1.2: Feature engineering a partir do mart `daily_anomaly_features` (ClickHouse): lags 1/7/14d, médias móveis 7/30d, componentes de Fourier do ciclo semanal, flag de feriado nacional, hora de abertura
- [x] 1.3: Split temporal: treino ≤ set/2025, validação out/2025, hold-out nov/2025–jan/2026 — implementado como função reutilizável, não hardcoded inline
- [x] 1.4: Treinar Prophet (baseline, sem features adicionais) e LightGBM; ensemble por média ponderada
- [x] 1.5: Registrar experimento no MLflow: params, métricas (MAPE por prioridade, MAE, cobertura do IC 80%), artefatos, hash/versão do dataset consumido
- [x] 1.6: Promover a melhor run para `Production` no MLflow Model Registry (script ou task manual documentada)
- [x] 1.7: Chart `infra/charts/ml-volume-model` (`Job` template) + `infra/apps/ml-volume-model.yaml` (`ArgoCD Application`, sync manual/on-demand — sem cron no MVP)
- [x] 1.8: Testes unitários das funções de feature engineering e do split temporal (sem vazamento de futuro)

### Verification

- [ ] `Job` roda no cluster (`kubectl apply` via ArgoCD) e completa sem erro sobre os marts reais — **pendente**: cluster local não subiu nesta sessão (decisão explícita do usuário); código verificado apenas localmente (15 testes unitários + `helm template` + `ruff`)
- [ ] Run aparece no MLflow UI com métricas e artefatos; modelo em estágio `Production` — **pendente**, mesma razão
- [ ] LightGBM bate Prophet no hold-out — **pendente de dado real**; lógica de comparação implementada e logada como param `lgb_beats_prophet_holdout`

---

## Phase 2: Modelo de Breach (LightGBM + isotonic + SHAP)

O modelo mais crítico da proposta — se o sinal não existir no dado real, o produto precisa ser revisado antes da Sprint 4.

### Tasks

- [ ] 2.1: App `apps/ml-breach-model/` (Python, `workload: job`, `namespace: ml`)
- [ ] 2.2: Filtro do dataset de treino a partir dos marts: P1–P3, sem `incidente_pai`, sem "Sem Intervenção" (`entrou_kpi = 1`)
- [ ] 2.3: Feature engineering: precursor P4 (`p4_sequences_by_ci`), tempo no primeiro grupo vs. 25% do OLA (`first_touch_duration`), contagem de "Sem Intervenção" no IC (1h/6h), flag de abertura manual, carga do grupo designado via snapshot Redis, hora/dia da semana
- [ ] 2.4: Split temporal idêntico ao da fase 1 (mesma função reutilizada)
- [ ] 2.5: Otimização de hiperparâmetros via Optuna (50 trials), `class_weight='balanced'`
- [ ] 2.6: Calibração isotônica pós-treino; gerar reliability diagram antes/depois como artefato
- [ ] 2.7: SHAP calculado por inferência (top-5), validado num batch de exemplo antes de subir para serving
- [ ] 2.8: Registrar no MLflow (params, AUC-PR, Brier score, recall@top-10, recall@top-50/hora, artefatos); promover para `Production`
- [ ] 2.9: Chart `infra/charts/ml-breach-model` (`Job`) + `infra/apps/ml-breach-model.yaml`
- [ ] 2.10: Testes unitários do filtro de elegibilidade KPI e das features de domínio

### Verification

- [ ] AUC-PR em hold-out temporal > 0,60
- [ ] Reliability diagram mostra melhora visível pós-calibração
- [ ] SHAP top-5 consistente com as features de domínio esperadas (precursor P4 aparece com peso relevante)
- [ ] Modelo em estágio `Production` no MLflow Registry

---

## Phase 3: `burst-detector`

Consumer stateless — sem treino, sem ciclo de retreino. Decisão de design central: limiar adaptativo por IC.

### Tasks

- [ ] 3.1: App `apps/ml-burst-detector/` (Python, `workload: deployment`, `namespace: ml`, worker puro sem HTTP)
- [ ] 3.2: Consumer Kafka grupo `burst-detector`, lê `incidents.received`
- [ ] 3.3: Estado por IC em Redis: contagem em janelas 15min/1h/6h, mediana histórica, MAD histórico
- [ ] 3.4: z-score robusto por IC (mediana + MAD) — limiar adaptativo, não global
- [ ] 3.5: CUSUM bidirecional para detecção de mudança de regime gradual
- [ ] 3.6: Publicar em `alerts.burst` quando z > 3,5 em qualquer janela
- [ ] 3.7: Métricas Prometheus (`/metrics` via server HTTP mínimo só para scrape, sem endpoints de negócio)
- [ ] 3.8: Chart `infra/charts/ml-burst-detector` (`Deployment`) + `infra/apps/ml-burst-detector.yaml`
- [ ] 3.9: Testes unitários do z-score adaptativo e do CUSUM contra séries sintéticas (pico pontual vs. mudança gradual)
- [ ] 3.10: Script/notebook que calcula precision dos alertas, lead-time mediano antes do P2 e falsos positivos por IC usando `assets/incidents.csv` como ground truth histórico

### Verification

- [ ] Consumer processa eventos do tópico sem lag crescente sob carga do simulador
- [ ] Alertas em `alerts.burst` aparecem para picos e mudanças de regime sintéticos (smoke test)
- [ ] Precision, lead-time mediano e FP/IC calculados e documentados em `docs/insights/`

---

## Phase 4: `model-serving`

Interface única entre os modelos treinados e o resto do sistema (copiloto, painel).

### Tasks

- [ ] 4.1: App `apps/ml-model-serving/` (Python + FastAPI, `workload: deployment`, `namespace: ml`)
- [ ] 4.2: Carregamento dos artefatos do MLflow Registry no startup (URI `models:/<name>/Production` para volume e breach)
- [ ] 4.3: `POST /predict/volume` — retorna previsão D+1 e D+7 com intervalo de confiança
- [ ] 4.4: `POST /predict/breach` — retorna score calibrado e SHAP top-5
- [ ] 4.5: Schemas Pydantic V2 em request/response de ambos os endpoints
- [ ] 4.6: `GET /health` e métricas Prometheus em `/metrics`
- [ ] 4.7: Chart `infra/charts/ml-model-serving` (`Deployment + HPA + Service`) + `infra/apps/ml-model-serving.yaml`
- [ ] 4.8: Testes unitários dos schemas e de um smoke test de inferência com modelo mockado

### Verification

- [ ] `POST /predict/volume` e `POST /predict/breach` respondem com payload correto contra os modelos `Production` reais
- [ ] `/health` e `/metrics` respondem; HPA configurado e visível no cluster

---

## Phase 5: Validação ponta a ponta

Confere os critérios de aceite da spec contra o dado real e documenta os números que entram no material de entrega da Sprint 3.

### Tasks

- [ ] 5.1: Rodar os `Job`s de treino sobre o dataset completo (122.543 linhas) e confirmar conclusão sem erro
- [ ] 5.2: Coletar do MLflow: MAPE/MAE/IC 80% do volume por prioridade, AUC-PR/Brier/recall@top-k do breach, e registrar em `docs/insights/ml_models_baseline.md`
- [ ] 5.3: Rodar `burst-detector` contra o histórico via simulador e confirmar precision, lead-time mediano e FP/IC documentados
- [ ] 5.4: Testar `model-serving` com incidentes reais do hold-out (chamadas diretas aos dois endpoints) e conferir SHAP/score fazem sentido
- [ ] 5.5: Atualizar `docs/sprints/sprint-3-mvp.md` com os resultados reais dos modelos (seção 5, substituindo os placeholders)

### Final Verification

- [ ] Todos os acceptance criteria da spec atendidos
- [ ] AUC-PR do breach > 0,60 confirmado com dado real (ou risco documentado se não bater)
- [ ] Testes unitários das 4 apps verdes em CI
- [ ] ArgoCD reconciliando `ml-volume-model`, `ml-breach-model`, `ml-burst-detector`, `ml-model-serving` sem drift
- [ ] PR mergeado em `main` com revisão

---

_Generated by Conductor. Tasks will be marked [~] in progress and [x] complete._
