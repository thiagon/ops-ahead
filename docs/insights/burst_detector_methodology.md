# Metodologia de avaliação do detector de rajada

**Data:** 2026-08-17
**Track:** `ml-layer2-gaps_20260817`, Fase 4

O número original do backtest (`docs/insights/ml_models_baseline.md`) tinha um viés: um alerta contava
como acerto se qualquer P1/P2 aparecesse no mesmo IC dentro de 1h, sem piso de antecedência. Como o
alerta é levantado processando um evento que costuma pertencer à mesma rajada do incidente grave, o
"acerto" acontecia com segundos de diferença — sem tempo de ação. Esta fase corrige três coisas em
`apps/ml-burst-detector/scripts/backtest.py` (lógica movida para `src/backtest_metrics.py`, testável):

1. **Piso de lead-time.** Um acerto exige o P1/P2 pelo menos `MIN_LEAD_TIME_SECONDS` (900s = 15min)
   depois do alerta — o limite de escalonamento real do N1 (`docs/insights/03-mentoria-insights.md`,
   "Regra de Escalonamento Interno do N1"). Abaixo disso, "o alerta disparou antes do P1/P2" não se
   distingue de "o alerta disparou por causa da rajada do próprio P1/P2".
2. **Recall.** Além de precision (dos alertas, quantos acertam), agora mede recall (dos P1/P2 do
   histórico, quantos tiveram um alerta qualificado antes).
3. **Janela de calibração × avaliação.** O CSV é dividido cronologicamente 70/30 — parâmetros nunca
   são escolhidos e medidos na mesma janela.

## Resultado

| Janela | Alertas | P1/P2 | Cobertos | Precision | Recall | Lead-time mediano |
|--------|---------|-------|----------|-----------|--------|--------------------|
| Calibração (85.780 linhas) | 14.470 | 12.454 | 217 | 0,037 | 0,017 | 1.695s (28min) |
| Avaliação (36.763 linhas) | 8.517 | 3.196 | 20 | 0,003 | 0,006 | 1.506s (25min) |

Por tipo de alerta (janela de calibração):

| Tipo | Alertas | Precision | Lead-time mediano |
|------|---------|-----------|---------------------|
| `regime_change` (CUSUM) | 9.487 | 0,020 | 2.041s |
| `spike` (z-score) | 4.983 | 0,071 | 1.480s |

**O piso de lead-time muda o retrato inteiro.** Sem ele, a Fase 3 do `ml-models_20260806` reportava
precision 0,103 e lead-time de 9s — um "acerto" que não dava tempo de ação nenhum. Com o piso de 15min,
precision cai para 0,037 (calibração) e a maioria dos alertas some do numerador — sinal de que o "acerto"
anterior era quase todo detecção simultânea, não antecipação real. O que sobra depois do piso (lead-time
mediano ~28min) é pouco (recall 0,017) mas genuíno: quando o detector acerta, dá tempo real de ação.

A curva precision × recall em função de `Z_SCORE_THRESHOLD` (janela de calibração) está achatada — variar
o limiar de 1,5 a 5,0 move recall entre 0,017 e 0,024 e precision entre 0,036 e 0,039. `Z_SCORE_THRESHOLD`
sozinho não é a alavanca; a Fase 5 varre também `CUSUM_K`/`CUSUM_H`/`MIN_ROBUST_STD` antes de decidir se
existe operating point defensável.
