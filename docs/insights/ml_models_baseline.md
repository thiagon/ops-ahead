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

## `model-serving`

Serviço no ar em `ns: ml`, carregando `models:/volume-forecast/Production` e `models:/breach-risk/Production`
no startup. Testado apenas com smoke test e modelo mockado (Fase 4) — chamada real aos endpoints
`POST /predict/volume`/`POST /predict/breach` com incidentes do hold-out **não foi executada** nesta
validação. Fica como follow-up junto da ingestão completa.

## Conclusão

O mecanismo fim-a-fim (Camada 2 inteira: volume, breach, burst-detector, model-serving) funciona contra
dado real. A pergunta que a track original se propunha a responder — "o sinal preditivo existe no dado
real, com AUC-PR > 0,60?" — continua em aberto até a ingestão completa rodar; não é respondida por este
documento.
