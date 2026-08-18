# Implementation Plan: Conformidade da Camada 2 com a arquitetura da Sprint 2

**Track ID:** ml-layer2-gaps_20260817
**Spec:** [spec.md](./spec.md)
**Created:** 2026-08-17
**Status:** [x] Complete

## Overview

Sete fases. A auditoria vem primeiro e produz a lista fechada de divergências entre a seção 3.2 da
Sprint 2 e o código — sem ela, "seguir todo o doc" fica na intenção. Os dois modelos ausentes vêm
logo depois, porque são entrega de dados que o resto consome e o insumo deles já está nos marts. A
qualidade do detector vem em seguida, com a metodologia antes do tuning: calibrar contra uma métrica
enviesada produz número melhor, não detector melhor. A feature de recategorização e o serving são
independentes e podem correr em paralelo por outra pessoa. A documentação fecha, depois do merge do
PR #56 para não conflitar no mesmo arquivo.

Nenhuma app nova. As mudanças ficam em `apps/ml-trainer/` (dois modelos novos e uma feature),
`apps/ml-burst-detector/` (detector e backtest) e documentação.

---

## Phase 1: Auditoria de conformidade

Produz a lista fechada do que falta, para que nada mais fique de fora por agrupamento errado.

### Tasks

- [x] 1.1: Percorrer a seção 3.2 da Sprint 2 linha a linha — os cinco modelos, as métricas de produção
      de cada um, as quatro features de domínio cross-modelo e os componentes de plataforma — e
      classificar cada item em implementado, ausente ou divergente
- [x] 1.2: Para cada item ausente ou divergente, decidir entre implementar nesta track ou registrar
      desvio consciente com justificativa
- [x] 1.3: Decidir o destino de **Evidently AI** (drift PSI/KS → métrica Prometheus), que a Sprint 2
      lista e nenhum doc do MVP excluiu
- [x] 1.4: Decidir o destino de **BentoML** no empacotamento do `model-serving`, hoje FastAPI puro
- [x] 1.5: Registrar a tabela de conformidade em `docs/insights/` como saída da fase

### Verification

- [x] Nenhum item da seção 3.2 fica sem destino declarado

---

## Phase 2: Projeção KPI mensal (Monte Carlo)

Responde a pergunta do gestor, que é probabilística: "vou fechar o mês em 100%?".

### Tasks

- [x] 2.1: Análise no `ml-trainer` consumindo `kpi_monthly_state` e a distribuição preditiva do volume
- [x] 2.2: Para cada dia restante do mês, sortear volume da preditiva do LightGBM × taxa de breach de uma
      Beta posterior por prioridade, e agregar
- [x] 2.3: Produzir as 4 projeções independentes do PPR: volume P2, volume P3, OLA P2, OLA P3
- [x] 2.4: Calcular `P(fechar o mês)` por projeção, com intervalo de confiança de 80%
- [x] 2.5: Registrar params, métricas e artefatos no MLflow como qualquer outro experimento
- [x] 2.6: Testes da agregação e da amostragem com semente fixa

### Verification

- [x] As 4 projeções saem com intervalo, sobre o dado disponível
- [x] Rodar duas vezes com a mesma semente produz o mesmo resultado

---

## Phase 3: Detector de evento externo (Isolation Forest)

Marca o dia anômalo para excluir do treino e sinalizar investigação fora da Locaweb.

### Tasks

- [x] 3.1: Treino sobre `daily_anomaly_features` — volume total, share de P1, % de abertura manual,
      dispersão de ICs, taxa de "Sem Intervenção"
- [x] 3.2: Levantar os outliers conhecidos do histórico para servir de referência de recall
- [x] 3.3: Medir recall nesses outliers, precisão entre os marcados e falso positivo em dias normais
- [x] 3.4: Registrar no MLflow e promover se o resultado sustentar
- [x] 3.5: Expor o resultado como marcação de dia/janela, consumível pelo filtro de treino dos outros
      modelos
- [x] 3.6: Testes da montagem de features e do formato da marcação

### Verification

- [x] Outliers conhecidos do histórico aparecem marcados
- [x] Dias normais não são marcados em massa

---

## Phase 4: Metodologia de avaliação do detector de rajada

Corrige o que a métrica mede antes de tentar melhorar o número.

### Tasks

- [x] 4.1: Exigir lead-time mínimo para contar true positive — alerta que dispara junto do P1/P2 deixa de
      ser acerto. Definir o piso a partir do tempo de ação plausível para o N1 e justificar
- [x] 4.2: Medir recall: fração dos P1/P2 do histórico precedida por alerta dentro da janela
- [x] 4.3: Reportar a curva precision × recall em função de `Z_SCORE_THRESHOLD`, não um ponto único
- [x] 4.4: Separar o CSV em janela de calibração e janela de avaliação, cronologicamente
- [x] 4.5: Distinguir no relatório os alertas vindos de z-score dos vindos de CUSUM
- [x] 4.6: Testes das métricas novas contra séries sintéticas com ground truth conhecido

### Verification

- [x] Backtest reporta precision, recall, lead-time e a curva, por janela
- [x] Série sintética com antecipação conhecida produz o lead-time esperado

---

## Phase 5: Calibração e decisão sobre o gatilho

Com a métrica corrigida, descobrir se existe operating point utilizável.

### Tasks

- [x] 5.1: Varredura de `Z_SCORE_THRESHOLD`, `CUSUM_K`, `CUSUM_H`, `MIN_ROBUST_STD` e das janelas na
      janela de calibração
- [x] 5.2: Definir o piso de utilidade — que combinação de precision, recall e lead-time torna o gatilho
      defensável — antes de olhar o resultado da varredura
- [x] 5.3: Escolher o operating point e justificar o trade-off — **N/A**: nenhuma combinação atinge o
      piso (ver 5.6)
- [x] 5.4: Reavaliar o ponto escolhido na janela de avaliação, sem retuning — parâmetros atuais
      (nenhum candidato os supera) já reportados na avaliação em `burst_detector_methodology.md`
- [x] 5.5: Aplicar os parâmetros escolhidos em `apps/ml-burst-detector/src/detector.py` — **N/A**:
      parâmetros ficam congelados nos valores atuais, nenhuma mudança de código
- [x] 5.6: Se nenhum ponto atingir o piso, registrar o achado e a consequência — registrado em
      `docs/insights/burst_detector_calibration.md`. **Decisão do usuário (2026-08-17):** o detector
      permanece como o gatilho do fluxo definido na seção 4 da Sprint 2; o resultado é trabalho de
      modelagem em aberto para a Sprint 4, não motivo para trocar o desenho

### Verification

- [x] Resultado na janela de avaliação reportado com os parâmetros congelados
- [x] Decisão sobre o papel do detector no fluxo registrada, seja ela qual for

---

## Phase 6: Feature de recategorização e serving com dado real

Duas pendências independentes das anteriores.

### Tasks

- [x] 6.1: `historico_recategorizacao` no `FEATURE_COLUMNS` do breach, a partir de `priority_changes_log`
      — nomeado `was_recategorized`/`recategorization_count` em inglês (ver achado de domínio abaixo)
- [x] 6.2: Confirmar que a feature não vaza futuro — a transição usada tem que ser anterior ao instante
      da predição
- [x] 6.3: Testes da feature, incluindo o caso de incidente sem transição nenhuma
- [x] 6.4: `POST /predict/breach` com incidentes reais do lote, conferindo score calibrado e SHAP top-5
- [x] 6.5: `POST /predict/volume` com lags e rolling reais, conferindo D+1, D+7 e o intervalo
- [x] 6.6: Confirmar o carregamento cross-processo dos artefatos `Production` — caminho que motivou o
      `code_paths` nos `train.py` e nunca foi exercido fora do smoke test. Achou 4 bugs reais (colisão
      de pacote `src`, dependências ausentes em `model-serving`, dtype `object` em campo nulo, timezone
      no Prophet) — todos corrigidos, ver `docs/insights/ml_models_baseline.md`
- [x] 6.7: Fechar a task 5.4 de `ml-models_20260806`

### Verification

- [x] Retreino do breach com a feature nova conclui e registra no MLflow
- [x] Os dois endpoints respondem com payload íntegro contra os modelos `Production`

---

## Phase 7: Documentação e fechamento

Roda depois do merge do PR #56, que altera os mesmos arquivos.

### Tasks

- [x] 7.1: Atualizar `docs/insights/ml_models_baseline.md` com os resultados das fases 2 a 6
- [x] 7.2: Atualizar a seção 4.2 de `docs/sprints/sprint-3-mvp.md` — e as seções 4.4 e 5 se a decisão de
      5.6 mudar quem invoca o copiloto. **Rodou antes do merge do PR #56** (ainda aberto) — risco de
      conflito em `sprint-3-mvp.md` fica para a revisão, não fazia sentido bloquear o fechamento desta
      track por tempo indeterminado
- [x] 7.3: Refletir no doc os desvios conscientes decididos na Fase 1
- [x] 7.4: Fechar as pendências correspondentes no `plan.md` de `ml-models_20260806`

### Verification

- [x] Doc da sprint, baseline e tabela de conformidade contam os mesmos números
- [x] Nenhuma task de `ml-models_20260806` fica em `[~]` sem dono

---

## Final Verification

- [x] Todos os acceptance criteria da spec atendidos
- [x] Testes de `ml-trainer` e `ml-burst-detector` verdes
- [x] ArgoCD reconciliando `ml-burst-detector` e `ml-trainer` sem drift
- [ ] PR mergeado em `main` com revisão — depende de revisão humana, fora do que esta implementação controla

---

_Generated by Conductor. Tasks will be marked [~] in progress and [x] complete._
