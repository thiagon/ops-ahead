# Specification: Conformidade da Camada 2 com a arquitetura da Sprint 2

**Track ID:** ml-layer2-gaps_20260817
**Type:** Feature
**Created:** 2026-08-17
**Status:** Draft

## Summary

Fechar a distância entre a Camada 2 implementada e a Camada 2 especificada na seção 3.2 de
`docs/sprints/sprint-2-architecture.md`: dois modelos que nunca foram construídos, uma feature de
domínio ausente, o monitoramento de drift, e a qualidade do detector de rajada. A Camada 2 é
entrega de dados e pré-requisito das camadas superiores — o que falta aqui bloqueia o resto.

## Context

A track `ml-models_20260806` entregou três dos cinco modelos que a arquitetura da Sprint 2 define
para a Camada 2. Os outros dois nunca foram construídos, e a exclusão registrada em
`sprint-3-mvp.md` não os cobre — ela tira a forma de servir, não o modelo:

| Sprint 2, seção 3.2 | Estado | Exclusão registrada no MVP |
|---------------------|--------|----------------------------|
| Volume D+1/D+7 | Implementado | — |
| Risco de breach | Implementado | — |
| Detecção de rajada | Implementado, qualidade não sustentada | — |
| Projeção KPI mensal (Monte Carlo) | **Inexistente** | Sai o *endpoint*; "a lógica Python pode ser validada como script antes de virar endpoint" |
| Detector de evento externo (Isolation Forest) | **Inexistente** | Sai o *servir*; "modelo pode ser treinado no MVP" |

O insumo dos dois já existe nos marts: `daily_anomaly_features` tem as colunas que a Sprint 2 lista
para o Isolation Forest (volume total, share de P1, % de abertura manual, dispersão de ICs, taxa de
"Sem Intervenção"), e `kpi_monthly_state` é a base da projeção mensal.

Três divergências menores no que foi implementado:

- Das quatro **features de domínio cross-modelo** da mentoria, três estão no `FEATURE_COLUMNS` do
  breach. **Histórico de recategorização** não está, embora o mart `priority_changes_log` exista
- **Evidently AI** (PSI/KS por feature → métrica Prometheus) não foi implementado nem excluído do MVP
- A Sprint 2 especifica `model-serving` como **FastAPI + BentoML**; a implementação é FastAPI puro

E duas pendências de qualidade que não dependem da carga completa do dataset:

**O detector de rajada tem número real e o número não sustenta o papel.** O backtest replaya o CSV
completo em memória, sem cluster: precision 0,103 e lead-time mediano de 9 segundos antes do P1/P2.
Nove segundos não dão tempo de ação — na prática o detector sinaliza a rajada que já contém o
incidente grave. Como ele é o gatilho que invoca o copiloto, isso contamina o blind review.

**O `ml-model-serving` nunca foi chamado com dado real.** Está no ar carregando os artefatos
`Production`, mas só foi exercitado com modelo mockado. A task 5.4 de `ml-models_20260806` ficou
em `[~]` por isso.

## User Story

Como avaliador do challenge, quero que a Camada 2 entregue os cinco modelos que a arquitetura
promete, com as métricas de produção que cada um declara, para julgar a solução pelo que foi
especificado e não por uma versão reduzida sem justificativa registrada.

## Acceptance Criteria

- [ ] Toda linha da seção 3.2 da Sprint 2 tem destino explícito: implementada nesta track, ou desvio
      consciente registrado no doc com o porquê
- [ ] Projeção KPI mensal roda como script validado, produzindo as 4 projeções do PPR (volume P2,
      volume P3, OLA P2, OLA P3) com intervalo de confiança
- [ ] Detector de evento externo treinado sobre `daily_anomaly_features`, com os outliers conhecidos do
      histórico usados como referência de recall
- [ ] `historico_recategorizacao` entra no `FEATURE_COLUMNS` do breach, alimentada por
      `priority_changes_log`
- [ ] Backtest do detector mede recall além de precision, e exige lead-time mínimo para contar acerto
- [ ] Existe operating point escolhido com justificativa, ou a constatação registrada de que nenhum
      ponto da curva sustenta o gatilho — e, nesse caso, a consequência para o desenho do fluxo
- [ ] `POST /predict/breach` e `POST /predict/volume` respondem contra os modelos `Production` reais
- [ ] Task 5.4 de `ml-models_20260806` fechada

## Dependencies

- Marts `daily_anomaly_features`, `kpi_monthly_state` e `priority_changes_log` em `main` — atendido
- `priority_changes_log` está com 0 linhas no lote ingerido, o que é correto para aquele batch mas
  significa que a feature de recategorização precisa de dado que exercite a transição
- PR #56 altera `docs/sprints/sprint-3-mvp.md` e `conductor/tracks.md`; a atualização de doc desta
  track deve ser sincronizada depois do merge

## Out of Scope

- Carga completa do `incidents.csv` e as métricas que dependem dela (AUC-PR, MAPE, recall@top-k) — Sprint 4
- Servir Monte Carlo e Isolation Forest como endpoint — Sprint 4, conforme o MVP já registra
- Feast como feature store — excluído do MVP com justificativa registrada
- Camadas 3 e 4: copiloto, RAG, painel e Slack — track `mvp-closeout_20260817` (PR #56)
- Tratamento de recategorização ponta a ponta (`gateway` detecta transição → re-inferência →
  `incidents.scored`) — a Camada 2 entrega a feature e o endpoint; o gatilho é da track do gateway

## Technical Notes

**O ground truth do backtest tem um viés a corrigir.** Um alerta conta como acerto se qualquer P1/P2
aparecer no mesmo IC dentro de 1 hora, sem piso de antecedência. Como o alerta é levantado
processando um evento que costuma pertencer à mesma rajada do incidente grave, o acerto acontece com
segundos de diferença. Medir antecipação exige exigi-la na definição de acerto.

**Precision sozinha não decide.** Sem recall, 0,103 não distingue "dispara muito e acerta pouco" de
"dispara pouco mas cobre o que importa". A curva precision × recall em função de `Z_SCORE_THRESHOLD`
responde; um ponto único não.

**Tuning contra o próprio backtest é overfitting** — foi por isso que os hiperparâmetros ficaram nos
valores iniciais. A saída é separar janela de calibração e janela de avaliação no próprio CSV.

**Resultado negativo é resultado.** Se nenhum operating point sustentar o gatilho, o achado é
legítimo e muda o desenho: o copiloto passaria a ser invocado por score de breach acima de limiar,
com a rajada como sinal auxiliar. O inaceitável é entregar o gatilho sem saber.

**Monte Carlo e Isolation Forest entram como análise, não como serviço.** Rodam no `ml-trainer` sob
demanda, com o resultado registrado no MLflow como qualquer outro experimento. Virar endpoint é
Sprint 4.

---

_Generated by Conductor. Review and edit as needed._
