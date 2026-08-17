# Conformidade da Camada 2 com a Sprint 2, seção 3.2

**Data:** 2026-08-17
**Track:** `ml-layer2-gaps_20260817`, Fase 1 (auditoria)

Auditoria linha a linha de `docs/sprints/sprint-2-architecture.md`, seção 3.2, contra o código em
`apps/ml-trainer/`, `apps/ml-burst-detector/`, `apps/ml-model-serving/` e os marts de
`apps/data-runner/`. Cada linha recebe um destino: **implementado**, **implementado nesta track**, ou
**desvio consciente** com justificativa — nenhuma fica sem classificação.

## Componentes de plataforma

| Componente | Estado | Destino |
|------------|--------|---------|
| Treino e tracking (MLflow) | Implementado — `mlflow_tracking_uri`, `train_and_log`/`promote_latest` em `ml-trainer` | — |
| LightGBM (volume, breach) | Implementado | — |
| Prophet (baseline de volume) | Implementado — `train_prophet_per_series`, ensemble por MAE em `volume/train.py` | — |
| scikit-learn (calibração isotônica) | Implementado — `IsotonicRegression` em `breach/train.py` | — |
| scikit-learn (Isolation Forest) | Ausente | **Implementado nesta track** — Fase 3 |
| SciPy (Monte Carlo) | Ausente | **Implementado nesta track** — Fase 2 |
| SHAP | Implementado — `BreachRiskModel.predict` | — |
| Feature store (Feast) | Ausente | **Desvio já registrado** — `sprint-3-mvp.md` §3 exclui Feast do MVP explicitamente ("Redis direto é suficiente... Feast adiciona robustez, não funcionalidade nova"). Fora de escopo desta track também. |
| Servir modelos: FastAPI | Implementado | — |
| Servir modelos: BentoML (empacotamento) | Ausente — `model-serving` é FastAPI puro | **Desvio consciente, registrado agora**: BentoML empacota o que o Dockerfile + `models_loader.py` já resolvem (carga de artefato MLflow, serialização de request/response via Pydantic). Não há requisito do MVP que dependa de BentoML especificamente — A/B por header e model store não são usados no MVP. Reavaliar na Sprint 4 se surgir necessidade real de multi-model serving que o FastAPI puro não cubra. |
| Detecção de rajada (`burst-detector`, worker Kafka) | Implementado, qualidade não sustentada | **Corrigido nesta track** — Fases 4 e 5 |
| Monitoramento de drift (Evidently AI → métrica Prometheus) | Ausente, nenhum doc do MVP excluiu | **Desvio consciente, registrado agora**: drift pressupõe uma janela de produção rodando por tempo suficiente para haver o que comparar contra a janela de treino — não existe ainda nesta instância (a ingestão completa do dataset via `incident_producer.py` é ela mesma um follow-up, ver `docs/insights/ml_models_baseline.md`). Implementar Evidently sem uma janela de produção real produziria métrica sem sinal. Fica para Sprint 4, quando o pipeline estiver operando continuamente. |

## Modelos (tabela de algoritmos)

| Modelo | Estado | Destino |
|--------|--------|---------|
| Volume D+1/D+7 (LightGBM + Prophet) | Implementado | — |
| Risco de breach (LightGBM + isotonic + SHAP) | Implementado | — |
| Detecção de rajada (z-score + CUSUM) | Implementado, sem lead-time útil (backtest: precision 0,103, lead-time mediano 9s) | **Corrigido nesta track** — Fases 4 e 5 |
| Projeção KPI mensal (Monte Carlo) | Ausente | **Implementado nesta track** — Fase 2, como script/análise no `ml-trainer`, não endpoint (consistente com `sprint-3-mvp.md`: "a lógica Python pode ser validada como script antes de virar endpoint") |
| Detector de evento externo (Isolation Forest) | Ausente | **Implementado nesta track** — Fase 3, como treino registrado no MLflow, não endpoint (consistente com `sprint-3-mvp.md`: "modelo pode ser treinado no MVP; servir fica para Sprint 4") |

## Features de domínio cross-modelo

| Feature | Estado | Destino |
|---------|--------|---------|
| Sequência crescente de P4 | Implementado — `p4_precursor_present`/`p4_precursor_length` em `breach/features.py` | — |
| Tempo no grupo de primeiro toque vs. OLA | Implementado como proxy — `group_severity_historical_ola_ratio`/`_over_25pct_rate` (histórico expandido por grupo+severidade, não o handoff timestamp direto — o dataset não tem esse timestamp; ver docstring de `add_historical_group_severity_features`) | — |
| Flag de abertura manual | Implementado — `is_manual_open` | — |
| Histórico de recategorização | Ausente, embora `priority_changes_log` exista no mart | **Implementado nesta track** — Fase 6 |

## Resumo

| Categoria | Contagem |
|-----------|----------|
| Já implementado, sem ação | 10 |
| Implementado nesta track | 4 (Monte Carlo, Isolation Forest, feature de recategorização, correção do detector de rajada) |
| Desvio consciente registrado | 3 (Feast — já excluído no MVP; BentoML; Evidently AI) |

Nenhum item da seção 3.2 fica sem destino declarado.
