# Problema: treino e validação dependem do dataset completo estar ingerido, com limites de data fixos

**Data:** 2026-08-07
**Origem:** Fase 5 (validação ponta a ponta) da track `ml-models_20260806`
**Escopo deste documento:** só o problema. Nenhuma solução é proposta ou sugerida aqui — fica pra quando alguém decidir atacar isso.

## Serviços envolvidos

Cadeia completa entre o CSV original e o treino falhando, pra quem for atacar isso sem o contexto desta sessão:

- **`scripts/incident_producer.py`** — script local (não roda no cluster). Lê `assets/incidents.csv` (122.543 linhas, dataset original da Locaweb, colunas em português) e faz um `POST /webhook/incidents` pra cada linha, sequencialmente, contra o gateway. Aceita `--limit` (default 0 = todas as linhas) e `--speed` (eventos/segundo, default 0 = o mais rápido possível). É o único jeito de popular o cluster com dado — não existe importação em lote direto pro ClickHouse.
- **`ui-gateway`** (`apps/ui-gateway`, ns `ui`) — API HTTP (Fastify) que recebe o webhook, valida o schema do evento contra `contracts/incident-event.schema.json`, opcionalmente confere assinatura HMAC (`HMAC_ENABLED`, desligado em dev), e publica no tópico Kafka `incidents.received`.
- **`data-ingest`** (`apps/data-ingest`, ns `data`, `workload: worker`) — consumidor Kafka do tópico `incidents.received`. Persiste cada evento em duas frentes: ClickHouse (tabela raw de incidentes) e MinIO (Parquet, para o histórico bruto). É um `Deployment` que fica sempre no ar, consumindo o que existir no tópico.
- **`data-transform`** (`apps/data-transform`, `workload: pipeline-step`, sem `Application` própria) — projeto dbt-clickhouse. Materializa os marts a partir da tabela raw: `daily_anomaly_features`, `first_touch_duration`, `p4_sequences_by_ci`, `incidents_by_ic`, `priority_changes_log`, `kpi_monthly_state`. É o dbt run que os dois modelos de ML leem.
- **`pipelines/data-itsm-daily`** — não é uma app, é config (`values.yaml` + `appset.yaml`) que aponta pro chart genérico `infra/charts/data-pipeline`. Esse chart define uma `WorkflowTemplate` do Argo Workflows (`dbt-run → great-expectations → register-snapshot`) que materializa os marts acima e roda as suítes de qualidade (Great Expectations) antes de qualquer coisa depender deles. Disparo hoje é manual (`argo submit --from workflowtemplate/data-pipeline -n data --watch`, documentado em `docs/data-pipeline.md`); não há cron ativo.
- **`ml-volume-model`** e **`ml-breach-model`** (`apps/`, ns `ml`, `workload: job`) — os dois `Job`s de treino. Leem os marts acima do ClickHouse (`daily_anomaly_features` o volume, `first_touch_duration` + outros o breach), passam o dataframe por `src/split.py::temporal_split()` (limites fixos vindos de `infra/apps/ml-temporal-split-values.yaml`, compartilhado pelos dois) e treinam/registram no MLflow. É aqui que o erro deste documento aparece — mas a causa está lá atrás, na cobertura real do dado nas etapas anteriores, não no código do treino em si.
  Detalhe operacional de hoje, relevante pra quem for iterar em cima disso: cada `Job` é um `batch/v1 Job` com nome fixo, gerenciado por uma `ArgoCD Application` (`infra/apps/ml-volume-model.yaml` / `ml-breach-model.yaml`) com `syncPolicy` manual. Depois que um `Job` termina (`Succeeded` ou `Failed`), não existe "rodar de novo" reaplicando o mesmo manifesto — é preciso `kubectl delete job` seguido de `argocd app sync` (ou o clique equivalente na UI) pra recriar. Ou seja: toda vez que alguém ingerir mais dado e quiser testar o split de novo, esse passo manual entra no meio.

## Sintoma

Ao subir o cluster local e rodar `ml-volume-model` e `ml-breach-model` pela primeira vez nesta instância, os dois `Job`s falharam com:

```
ValueError: temporal_split produced empty partition(s) ['validation', 'holdout'] for boundaries
train_end='2025-09-30' validation_end='2025-10-31' holdout_end='2026-01-31' — the dataset's
actual date range likely doesn't match these boundaries anymore.
```

Não é um bug de lógica — é o guard de `split.py` funcionando exatamente como projetado (ver `_raise_if_any_partition_empty`). O que ele pegou: o ClickHouse local tinha apenas **606 incidentes** em `first_touch_duration` (e 283 dias em `daily_anomaly_features`), cobrindo **2023-01-02 até 2025-01-04**. O dataset completo (`assets/incidents.csv`) tem **122.543 linhas**, cobrindo **2023-01-02 até 2025-12-31**. Os 606 registros vêm de uma validação anterior que replayed deliberadamente só 1.000 eventos (`docs/insights/pipeline_e2e_baseline.md`), não o histórico inteiro.

Ou seja: os limites de split (`train_end=2025-09-30`, `validation_end=2025-10-31`, `holdout_end=2026-01-31`) só produzem partições não-vazias se o dataset **completo e específico** já tiver sido ingerido ponta a ponta no ambiente. Qualquer coisa menor que isso — um subconjunto, um dataset sintético, uma janela de tempo diferente — quebra o treino.

## Causa raiz

- `apps/ml-volume-model/src/split.py` e `apps/ml-breach-model/src/split.py` (duplicados por design entre as duas apps) recebem `train_end`/`validation_end`/`holdout_end` como datas de calendário fixas, definidas em `infra/apps/ml-temporal-split-values.yaml`.
- Essas datas foram calibradas para o range específico de `assets/incidents.csv` — o próprio comentário do arquivo de values confirma: *"Boundaries are validated against the real dataset (assets/incidents.csv, 2023-01-02 .. 2025-12-31): train ≈50k rows, validation ≈23k rows, holdout ≈50k rows — none empty."*
- Não existe nenhum modo de treinar ou validar de forma significativa contra um subconjunto do dado, um dataset sintético menor, ou uma janela de tempo diferente da que foi usada pra calibrar essas três datas. O sistema assume implicitamente que o dataset inteiro e específico já foi replayed no ambiente antes de qualquer treino funcionar.
- A ingestão do dataset completo depende de rodar `scripts/incident_producer.py` até o fim (122.543 requests HTTP sequenciais contra o gateway, sem `--limit`) — um passo manual, sem automação, sem nenhuma verificação de "isso já rodou" em algum lugar visível, e sem relação nenhuma com o código do modelo em si.

## Impacto

- Qualquer ambiente novo — outra máquina, CI, cluster recriado do zero, outro integrante do time — começa "quebrado" para treino até alguém lembrar de rodar a ingestão completa manualmente. O erro que aparece (`ValueError` em `split.py`) não indica isso: parece um bug de código até alguém investigar o volume real de dados no ClickHouse.
- Não há como testar o pipeline de treino de ponta a ponta em escala menor ou mais rápida (por exemplo, alguns milhares de linhas, ou um recorte de poucos meses) — todo teste realista depende do dataset de produção completo, com o tempo de ingestão que isso implica.
- O funcionamento do sistema (treina / não treina) fica acoplado a um artefato externo ao código — o CSV específico e o range de datas que ele cobre — sem nenhuma validação declarada de "isso precisa estar assim" além do guard reativo em `split.py`, que só avisa depois que o treino já foi disparado e falhou.
