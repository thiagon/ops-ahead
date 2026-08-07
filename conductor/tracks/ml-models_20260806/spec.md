# Specification: Modelos de ML (Camada 2 — Inteligência)

**Track ID:** ml-models_20260806
**Type:** Feature
**Created:** 2026-08-06
**Status:** Draft

## Summary

Construir a Camada 2 da arquitetura: os dois modelos preditivos que validam a hipótese central do projeto (previsão de volume D+1/D+7 e risco de violação de OLA), o detector de rajada baseado em estatística (sem treino), e o `model-serving` que expõe os modelos treinados via FastAPI. Esta é a track que responde à primeira das três perguntas do MVP — "o sinal preditivo existe no dado real?"

## Context

O `data-pipeline_20260529` está completo (PR #49 mergeado, 2026-08-06): os 6 marts dbt estão populados em ClickHouse, incluindo `p4_sequences_by_ci` e `first_touch_duration`, que carregam as features de domínio validadas no EDA (precursor P4 confirmado quantitativamente, regra do N1 de 25% do OLA). A infra de `ns: ml` já está no ar desde a track `k8s-infra_20260514` — MLflow + Postgres e Redis prontos para uso, sem trabalho de infraestrutura pendente nesta track.

Esta track entrega o conteúdo da seção 4.2 do `docs/sprints/sprint-3-mvp.md`. O escopo cobre os quatro componentes do diagrama da Camada 2 (Volume, Breach, Rajada, MLflow/FastAPI) — o `burst-detector` entra aqui apesar de ter sido cotado como track separada ("Track 3") nas referências cruzadas do `data-pipeline`, por decisão explícita nesta sessão de manter a Camada 2 inteira em uma única track.

O que esta track não cobre é o consumo dessas previsões — isso é do copiloto (`agent`, Camada 3) e do painel (`ui`, Camada 4), que ficam para tracks seguintes.

## User Story

Como engenheiro de ML do time, quero treinar e servir os modelos de volume e breach com os dados reais do histórico ITSM, para que o time tenha uma resposta concreta — em métrica, não em intuição — sobre se o sinal preditivo dos padrões observados no EDA (precursor P4, sazonalidade, concentração de carga) se traduz em poder preditivo real.

Como operador N1/N2 (via copiloto e painel, consumidores futuros), quero que cada incidente tenha um score de breach calibrado com explicação (SHAP) e que rajadas sejam detectadas em near-real-time, para que a triagem tenha prioridade objetiva em vez de depender só da fila cronológica.

## Acceptance Criteria

- [ ] Modelo de volume (LightGBM, baseline Prophet) treinado com split temporal (treino ≤ set/2025, validação out/2025, hold-out nov/2025–jan/2026), registrado no MLflow com `params`, métricas (MAPE por prioridade, MAE, cobertura do intervalo de confiança de 80%) e versão do dataset; promovido para `Production` no Model Registry
- [ ] LightGBM bate o baseline Prophet de forma consistente no hold-out — se não bater, o motivo fica documentado antes de promover para `Production`
- [ ] Modelo de breach (LightGBM + calibração isotônica) treinado apenas nos incidentes elegíveis ao KPI (P1–P3, sem incidente pai, sem "Sem Intervenção"), com as features de domínio da mentoria (precursor P4, tempo no primeiro grupo vs. 25% do OLA, contagem de "Sem Intervenção" no IC, flag de abertura manual, carga do grupo via Redis, hora/dia)
- [ ] AUC-PR do modelo de breach > 0,60 em hold-out temporal — critério mínimo do doc para o produto ser defensável; recall@top-10 e recall@top-50 por hora e Brier score calculados e registrados
- [ ] Reliability diagram antes e depois da calibração isotônica, confirmando que o score calibrado tem leitura direta de probabilidade
- [ ] SHAP top-5 calculado a cada inferência e salvo junto ao score no payload de resposta
- [ ] `burst-detector` consumindo `incidents.received` do Kafka, com estado por IC em Redis (contagem em janelas 15min/1h/6h, mediana e MAD históricos), limiar z-score adaptativo por IC (não global) e CUSUM bidirecional para mudança de regime gradual
- [ ] `burst-detector` publica em `alerts.burst` quando z > 3,5 em qualquer janela; precision dos alertas, lead-time mediano antes do P2 e falsos positivos por IC calculados sobre o histórico real do CSV como ground truth
- [ ] `model-serving` (FastAPI) expõe `POST /predict/volume` (previsão D+1/D+7 com intervalo de confiança) e `POST /predict/breach` (score calibrado + SHAP top-5), carregando os artefatos do MLflow Registry no startup
- [ ] `model-serving` com schemas Pydantic V2 em request/response, `/health` e métricas Prometheus em `/metrics`, deploy `Deployment + HPA` em `ns: ml`
- [ ] `burst-detector` como `Deployment` em `ns: ml` (worker puro, sem HTTP)

## Dependencies

- **`data-pipeline_20260529`** (completo) — marts `incidents_by_ic`, `p4_sequences_by_ci`, `first_touch_duration`, `daily_anomaly_features` em ClickHouse
- **`k8s-infra_20260514`** (completo) — MLflow + Postgres e Redis já provisionados em `ns: ml`
- **`assets/incidents.csv`** — dataset histórico, usado para calcular lead-time do `burst-detector` como ground truth

## Out of Scope

- Consumo das previsões pelo copiloto (`agent`) — Camada 3, próxima track
- Painel N1/N2 exibindo score/SHAP — Camada 4, track futura
- Feast (feature store) — Redis direto é suficiente para as features online do MVP
- **Detector de evento externo / Isolation Forest (endpoint)** — Sprint 4, track própria. Não responde a nenhuma das três perguntas que o MVP precisa provar (sinal existe? E2E fecha em <60s? copiloto é acionável?). Quem consumiria esse endpoint é o painel tático (Grafana), também adiado pro Sprint 4 — servir um modelo sem consumidor no MVP é escopo sem evidência. Treinar o modelo em si não está bloqueado, mas fica fora desta track porque não está no diagrama da Camada 2 (seção 4.2) nem tem consumidor até lá.
- **Projeção KPI Monte Carlo (endpoint)** — Sprint 4, track própria. Depende da saída de Volume e Breach (`volume previsto × taxa de breach`) — construir um endpoint com contrato público em cima de modelos ainda não validados em hold-out é comprometer uma API antes de saber se o alicerce é sólido. O doc de referência já indica o caminho mais barato: validar a lógica como script Python descartável primeiro, só depois virar endpoint.
- Retreino automático ou pipeline de retreino agendado — MVP treina uma vez e promove; automação é refinamento futuro

## Technical Notes

- **Volume:** lags de 1/7/14 dias, médias móveis de 7/30 dias, componentes de Fourier para ciclo semanal (mais robusto que dummies de dia da semana), flag de feriado nacional, hora de abertura. Ensemble por média ponderada entre LightGBM e Prophet.
- **Breach:** `class_weight='balanced'` no treino resolve o desbalanceamento (1% de violação) para a classificação binária, mas distorce a probabilidade — por isso a calibração isotônica pós-treino é obrigatória, não opcional. Otimização de hiperparâmetros via Optuna (50 trials).
- **Rajada:** sem treino, atualiza online a cada evento — decisão de design que evita ciclo de retreino e overfitting. O limiar adaptativo por IC (mediana + MAD) é a peça central: um limiar global gera falso positivo no Team14 (volume naturalmente alto) e falso negativo em ICs silenciosos.
- **Split temporal é obrigatório** em ambos os modelos treinados — validação cruzada aleatória vaza futuro para o treino dado a sazonalidade forte do dataset (~30% de variação entre dia útil e fim de semana).
- **Métrica de breach é AUC-PR + recall@top-k, nunca acurácia** — com 1% de violação, um modelo que sempre prevê "não vai violar" teria 99% de acurácia e zero utilidade.

---

_Generated by Conductor. Review and edit as needed._
