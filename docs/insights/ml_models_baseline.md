# ML Models Baseline

**Data:** 2026-08-17
**Dataset:** amostra de 606 incidentes (`first_touch_duration`/`daily_anomaly_features` no ClickHouse local — o único volume ingerido nesta instância do cluster até agora, contra as 122.543 linhas de `assets/incidents.csv`)
**Ambiente:** k3d local

## Escopo desta validação

Esta é uma validação **estrutural**, não de qualidade de modelo: confirma que o mecanismo fim-a-fim
funciona (trigger → treino → registro → promoção → serving) contra dado real do cluster. Números de
qualidade preditiva (MAPE, AUC-PR, Brier, recall@top-k) sobre o dataset completo **não fazem parte
deste documento** — calculá-los contra uma amostra de 606 linhas seria enganoso, especialmente para o
breach (desbalanceamento extremo: ~1% de violação no dataset completo, a amostra atual pode ter zero ou
poucas violações). Ficam como follow-up quando `scripts/incident_producer.py` rodar até o fim nesta
instância. Decisão explícita do usuário: essa ingestão completa não bloqueia o fechamento da track
`ml-models_20260806`.

## Treino (via `ui-orchestrator` → `trigger.ml` → `ml-trainer`)

| Analysis | Splits (quantis 70/85/100% da amostra disponível) | Resultado |
|----------|----------------------------------------------------|-----------|
| `volume_forecast` | train_end `2024-09-09`, validation_end `2024-11-10`, holdout_end `2025-01-04` | ✅ Concluído, `volume-forecast` v1 promovido a `Production` no MLflow |
| `breach_risk` | train_end `2024-12-26`, validation_end `2025-01-02`, holdout_end `2025-01-04` | ✅ Concluído, `breach-risk` v1 promovido a `Production` no MLflow |

Nenhum dos dois runs exigiu mudança de código ou infra — validam a correção do `guard` de split
temporal introduzido na Fase 5 (falha alto se alguma partição sair vazia) e o fix de timezone descrito
abaixo.

**Atualização 2026-08-17 (`ml-layer2-gaps_20260817`):** `volume-forecast` v1 e `breach-risk` v1 foram
retreinados como v2/v4 respectivamente sob a correção da colisão de pacote descrita na seção
"`model-serving`" abaixo — os artefatos v1 nunca carregavam de verdade fora do processo de treino.

## Projeção KPI mensal (Monte Carlo) — execução real

`python -m main analyze kpi-projection`, contra `daily_anomaly_features`/`kpi_monthly_state` reais do
cluster (283 dias com feature completa, `as_of_date=2025-01-04`, 27 dias restantes no mês, 2000
simulações, seed 42). Sem target configurado nesta instância (PPR é input de negócio da Locaweb — ver
`kpi_projection/run.py`), então `P(fechar o mês)` não é reportado; mediana e IC 80% sim:

| Projeção | Mediana | IC 80% |
|----------|---------|--------|
| Volume P2 | 379 | [289, 483] |
| Volume P3 | 290 | [224, 365] |
| OLA P2 (breaches) | 4 | [1, 10,1] |
| OLA P3 (breaches) | 8 | [4, 16] |

Taxa de elegibilidade KPI usada: P2 21,7%, P3 100% (mês corrente, contagem pequena). Registrado em
MLflow, experimento `kpi-monthly-projection`.

## Detector de evento externo (Isolation Forest) — treino live

`python -m main train external_event`, contra `daily_anomaly_features` real do cluster (283 dias):
`external-event-detection` v1 registrado e promovido a `Production`, `contamination=0,05`,
`flagged_share=0,053` (15 de 283 dias marcados — consistente com o parâmetro). Números de recall/
precisão contra outliers conhecidos vêm do backtest offline abaixo, que reflete o dataset completo
(122.543 linhas), não esta amostra parcial de 283 dias.

## `burst-detector` — backtest offline (contra o CSV completo, 122.543 linhas)

Este componente **não depende do estado de ingestão do cluster** — o backtest (`apps/ml-burst-detector/scripts/backtest.py`) roda direto contra `assets/incidents.csv`, então já reflete o dataset completo:

| Métrica | Antes do fix | Depois do fix (`MIN_ROBUST_STD=1.0`) |
|---------|--------------|----------------------------------------|
| Precision dos alertas | 0,075 | 0,103 |
| Lead-time mediano antes do P2 | 28s | 9s |

Achado: z-score robusto retornava infinito quando o histórico de uma IC era "flat" (MAD=0) — 67,5% das
janelas no dado real, porque a maioria das ICs tem 0-1 incidente por bucket de 15min. Corrigido com piso
mínimo no desvio robusto. Precision ainda baixa mesmo pós-fix; hiperparâmetros (`CUSUM_K`/`CUSUM_H`/
`MIN_ROBUST_STD`) não foram tunados contra o próprio backtest para evitar overfitting nele.

**A tabela acima tem um viés de metodologia** — corrigido na track `ml-layer2-gaps_20260817`:
lead-time de 9s é um "acerto" simultâneo à rajada, não antecipação. Números corrigidos (piso de
lead-time, recall, janela de calibração/avaliação separada) em
`docs/insights/burst_detector_methodology.md`.

## Detector de evento externo (Isolation Forest) — backtest offline

Assim como o `burst-detector`, este backtest (`apps/ml-trainer/scripts/external_event_backtest.py`) roda
direto contra `assets/incidents.csv` — não depende do estado de ingestão do cluster, já reflete o
dataset completo (644 dias). Não existe rótulo externo de verdade no dataset, então a referência de
"outlier conhecido" é construída de forma objetiva: dia cujo z-score robusto (mediana + MAD, mesmo
método do `burst-detector`) do volume total, contra uma janela **móvel** de 60 dias anteriores (não o
histórico inteiro — testado primeiro, um z-score global marcava 19% dos dias como "outlier" só por
capturar a tendência de crescimento do volume ao longo do tempo, não eventos), cruza 3,5.

| Métrica | Valor |
|---------|-------|
| Dias com features completas | 644 |
| Dias "outlier conhecido" (referência) | 65 (10,1%) |
| Dias marcados pelo Isolation Forest (`contamination=0.05`) | 33 (5,1%) |
| Recall | 0,123 |
| Precisão | 0,242 |
| Falso positivo em dias normais | 0,043 |

**O pico de setembro/2025 citado na mentoria aparece na referência e é parcialmente capturado.** A
janela de referência marca 2025-09-01 a 2025-09-23 quase inteira como outlier; o Isolation Forest marca
7 desses dias (02, 04, 07, 11, 22, 23, 24/09) — confirma que o método de referência captura um evento
real documentado (`docs/insights/03-mentoria-insights.md`), não ruído, e que o detector tem sinal real,
ainda que incompleto.

**Como consumir a marcação.** `ExternalEventModel.predict()` (registrado em MLflow como
`external-event-detection`) retorna, por dia, `is_external_event` (0/1) e `anomaly_score`. Esta track
expõe a interface — carregar o modelo `Production` e filtrar dias marcados antes de montar o dataset de
treino de volume/breach é decisão de uma track futura, fora de escopo aqui (nenhum dos dois trainers foi
alterado).

## `model-serving`

**Atualizado em 2026-08-17, track `ml-layer2-gaps_20260817` (Fase 6).** A chamada real aos endpoints
nunca tinha sido exercida fora do smoke test com modelo mockado — quando finalmente testada, revelou
quatro bugs que mantinham `model-serving` incapaz de servir qualquer predição real, apesar de reportar
`status: ok`:

1. **Colisão de nome de pacote.** `ml-model-serving` roda como `python -m src.main` — seu próprio
   pacote se chama `src`. O MLflow tenta importar `src.volume.model.VolumeForecastModel` (o `__module__`
   gravado no pickle, porque `ml-trainer` também rodava como `python -m src.main`), e o Python resolve
   `src` para o pacote já carregado do `ml-model-serving`, nunca para o `code_paths` do artefato —
   `ModuleNotFoundError: No module named 'src.volume'`. Corrigido fazendo `ml-trainer` rodar de dentro
   de `src/` (`WORKDIR /app/src`, `python -m main`), então os modelos pickled como `volume.model.…`
   não colidem com nada que `ml-model-serving` já tenha carregado.
2. **Dependências de terceiros ausentes.** `code_paths` empacota o *código* dos modelos, não os imports
   de terceiros que esse código usa — `ml-model-serving` não tinha `lightgbm`/`shap`/`prophet`/
   `holidays`/`scikit-learn` instalados para desserializar os objetos.
3. **Dtype `object` em campo nulo.** `pd.DataFrame([request.model_dump()])` com uma única linha infere
   dtype `object` para `group_severity_historical_ola_ratio`/`_over_25pct_rate` quando o valor é `None`
   (o caso legítimo de "sem histórico prévio") — o LightGBM real rejeita dtype `object` (o mock do smoke
   test nunca validava isso).
4. **Timezone no Prophet.** A API HTTP aceita `date` em ISO 8601 com `Z`/offset, que vira `Timestamp`
   tz-aware — o Prophet rejeita `ds` tz-aware.

Os quatro corrigidos (commits da Fase 6); `breach-risk` e `volume-forecast` retreinados sob a imagem
corrigida (`breach-risk` v4, `volume-forecast` v2). Verificação real, contra os modelos `Production` no
cluster local:

```
POST /predict/breach  → 200, breach_probability=0.038, shap_top5 com 5 features reais
POST /predict/volume  → 200, D+1 e D+7 para "total" e "p2", com yhat_lower/yhat_upper
```

## Conclusão

O mecanismo fim-a-fim (Camada 2 inteira: volume, breach, projeção KPI, evento externo, burst-detector,
model-serving) funciona contra dado real, incluindo os dois endpoints HTTP servindo os modelos
`Production` — o que a track `ml-models_20260806` não tinha verificado. A pergunta que essa track
original se propunha a responder — "o sinal preditivo existe no dado real, com AUC-PR > 0,60?" —
continua em aberto até a ingestão completa rodar; não é respondida por este documento.
