# Implementation Plan: Qualidade da Camada 2 (detector de rajada e serving)

**Track ID:** ml-layer2-gaps_20260817
**Spec:** [spec.md](./spec.md)
**Created:** 2026-08-17
**Status:** [ ] Not Started

## Overview

Quatro fases. A metodologia de avaliação vem antes do tuning porque calibrar contra uma métrica
enviesada só produz um número melhor, não um detector melhor: enquanto o acerto não exigir
antecedência e o recall não for medido, não há como saber se um operating point é bom. Só depois
disso a varredura de hiperparâmetros tem sentido, e ela precisa de janelas separadas de calibração e
avaliação para não virar overfitting no backtest. O `ml-model-serving` é independente das duas
primeiras fases e pode ser feito em paralelo por outra pessoa. A documentação fecha, depois do merge
do PR #56 para não conflitar no mesmo doc.

Nenhuma app nova entra nesta track. As mudanças ficam em `apps/ml-burst-detector/` (detector e
backtest) e em documentação.

---

## Phase 1: Metodologia de avaliação do detector

Corrige o que a métrica mede antes de tentar melhorar o número.

### Tasks

- [ ] 1.1: Exigir lead-time mínimo para contar true positive — alerta que dispara junto do P1/P2 deixa de
      ser acerto. Definir o piso a partir do que é tempo de ação plausível para o N1 e justificar a escolha
- [ ] 1.2: Medir recall: fração dos P1/P2 do histórico precedida por alerta dentro da janela
- [ ] 1.3: Reportar a curva precision × recall em função de `Z_SCORE_THRESHOLD`, não um ponto único
- [ ] 1.4: Separar o CSV em janela de calibração e janela de avaliação, cronologicamente, e expor a
      escolha por parâmetro do backtest
- [ ] 1.5: Distinguir no relatório os alertas vindos de z-score dos vindos de CUSUM — hoje os dois somem
      dentro do mesmo total e não dá para saber qual detector carrega o resultado
- [ ] 1.6: Testes das métricas novas contra séries sintéticas com ground truth conhecido

### Verification

- [ ] Backtest roda sobre o CSV completo e reporta precision, recall, lead-time e a curva, por janela
- [ ] Uma série sintética com antecipação conhecida produz o lead-time esperado

---

## Phase 2: Calibração e decisão sobre o gatilho

Com a métrica corrigida, descobrir se existe operating point utilizável.

### Tasks

- [ ] 2.1: Varredura de `Z_SCORE_THRESHOLD`, `CUSUM_K`, `CUSUM_H`, `MIN_ROBUST_STD` e das janelas
      (15min/1h/6h) na janela de calibração
- [ ] 2.2: Definir o piso de utilidade — que combinação de precision, recall e lead-time torna o gatilho
      defensável para o operador — antes de olhar o resultado da varredura
- [ ] 2.3: Escolher o operating point e justificar o trade-off
- [ ] 2.4: Reavaliar o ponto escolhido na janela de avaliação, sem retuning
- [ ] 2.5: Aplicar os parâmetros escolhidos em `apps/ml-burst-detector/src/detector.py`
- [ ] 2.6: Se nenhum ponto atingir o piso de 2.2, registrar o achado e a consequência de desenho: o
      copiloto passa a ser invocado por score de breach acima de limiar e a rajada vira sinal auxiliar

### Verification

- [ ] Resultado na janela de avaliação reportado com os parâmetros congelados
- [ ] Decisão sobre o papel do detector no fluxo registrada, seja ela qual for

---

## Phase 3: `ml-model-serving` contra dado real

Primeira chamada real ao serviço desde que ele subiu.

### Tasks

- [ ] 3.1: Montar o payload de `POST /predict/breach` a partir de incidentes reais do lote ingerido,
      usando as colunas de `ml-breach-model/src/features.py::FEATURE_COLUMNS`
- [ ] 3.2: Conferir o score calibrado e o SHAP top-5 da resposta contra o esperado para aqueles incidentes
- [ ] 3.3: `POST /predict/volume` com lags e rolling reais; conferir D+1, D+7 e o intervalo de confiança
- [ ] 3.4: Confirmar que os artefatos `Production` carregam de fato no processo do serving — é o
      caminho que motivou o `code_paths` nos dois `train.py` e nunca foi exercido fora do smoke test
- [ ] 3.5: Registrar o resultado e fechar a task 5.4 de `ml-models_20260806`

### Verification

- [ ] Os dois endpoints respondem com payload íntegro contra os modelos `Production`
- [ ] Nenhum erro de unpickle no carregamento cross-processo

---

## Phase 4: Documentação e fechamento

Roda depois do merge do PR #56, que altera os mesmos arquivos.

### Tasks

- [ ] 4.1: Atualizar `docs/insights/ml_models_baseline.md` com precision, recall, lead-time e o operating
      point escolhido, e com o resultado do serving
- [ ] 4.2: Atualizar a seção 4.2 de `docs/sprints/sprint-3-mvp.md` — e a 4.4 e a 5, se a decisão de 2.6
      mudar quem invoca o copiloto
- [ ] 4.3: Fechar as pendências correspondentes no `plan.md` de `ml-models_20260806`

### Verification

- [ ] Doc da sprint e baseline contam os mesmos números
- [ ] Nenhuma task de `ml-models_20260806` fica em `[~]` sem dono

---

## Final Verification

- [ ] Todos os acceptance criteria da spec atendidos
- [ ] Testes de `ml-burst-detector` verdes
- [ ] ArgoCD reconciliando `ml-burst-detector` com os parâmetros novos
- [ ] PR mergeado em `main` com revisão

---

_Generated by Conductor. Tasks will be marked [~] in progress and [x] complete._
