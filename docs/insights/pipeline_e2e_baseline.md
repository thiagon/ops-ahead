# Pipeline E2E Baseline

**Data:** 2026-08-06
**Dataset:** 1.000 eventos (source `itsm`, subconjunto ordenado por `aberto_em` do `assets/incidents.csv`)
**Ambiente:** k3d local

## Ingestão

| Métrica | Valor |
|---------|-------|
| Eventos postados pelo producer (batch desta validação) | 1.000 |
| Linhas em `incidents_received` (total, inclui execuções de teste anteriores) | 1.055 |
| Arquivos Parquet no MinIO (`received/source=itsm/`) | 354 |

## DAG (WorkflowTemplate `data-pipeline`, run `data-pipeline-876d2` — última execução, pós-revisão de código)

| Step | Status | Duração |
|------|--------|---------|
| dbt-run | ✅ Succeeded | 11s |
| great-expectations | ✅ Succeeded | 13s |
| register-snapshot | ✅ Succeeded | 43s |
| **Total** | ✅ Succeeded | **1m27s** |

GE suite `critical`: 8/8 expectations passando (100%). Data Docs: 23 objetos publicados em `s3://ops-ahead-lake/ge-docs/`. Snapshot MLflow: hash `36664b3e5afe3162ff1e967c91b0309d9913c24f6dc4b0031ffb72504b042080`, experiment `data-pipeline-snapshots`, tag `source=itsm` — mesmo hash/contagens desde o primeiro run limpo (`data-pipeline-rg52p`); os runs seguintes (`2t9nj`, `876d2`) validaram fixes adicionais (Data Docs, revisão de código) sobre o mesmo dataset.

## Marts

| Mart | Linhas |
|------|--------|
| incidents_by_ic | 2.561 |
| p4_sequences_by_ci | 243 |
| first_touch_duration | 606 |
| priority_changes_log | 0 |
| daily_anomaly_features | 283 |
| kpi_monthly_state | 27 |

`priority_changes_log` = 0 é o valor correto para este batch: nenhum dos 1.000 incidents replayed teve uma segunda severidade registrada na mesma execução (ver bug corrigido abaixo — antes do fix a contagem era 1.000, todas espúrias).

`dbt test`: 28/28 verde (`_schema.yml`, todos os marts).

## Observações

Esta foi a primeira execução real da track de ponta a ponta — as Fases 3 e 4 tinham código escrito e tarefas marcadas `[x]` no plan.md, mas nunca tinham rodado contra o cluster. A validação encontrou e corrigiu **9 bugs reais**, nenhum deles coberto pelos testes unitários existentes (que rodam contra SQLite/mocks, não contra ClickHouse real):

1. **`gx.DataContext` não existe** na versão instalada do `great_expectations` (1.17) — quebrava o import de toda suite GE. `AbstractDataContext` é o tipo certo; importado direto do módulo que o declara (não via `gx.data_context...`, que o type checker não reconhece como export). Mesmo tratamento pro `UnexpectedRowsExpectation` (item abaixo), que tem o mesmo problema de export. Coberto agora pelos testes locais (Task 3.6).
2. **`data-pipeline-secret` nunca era criado** — `infra/charts/data-pipeline` referenciava o secret mas não tinha `ExternalSecret` nenhum. Adicionado `templates/external-secret.yaml`.
3. **`minioEndpoint` apontava pro namespace errado** (`infra`, deveria ser `data` — onde o MinIO de fato roda).
4. **`mlflowUri` usava o nome de serviço errado** (`mlflow`, o serviço real é `mlflow-tracking`).
5. **Dockerfiles de `data-transform` e `data-quality` nunca instalavam as próprias dependências** — faziam bind-mount do `pyproject.toml` da raiz do workspace (vazio) em vez do pyproject.toml do próprio app, e não passavam `--package`. As imagens rodavam sem `dbt-clickhouse` nem `great_expectations` instalados. O `data-ingest/Dockerfile` já tinha o `--package` certo, mas contornava o problema listando um `COPY` por `pyproject.toml` de cada membro do workspace — uma lista que precisaria ser editada toda vez que um app novo entrasse no workspace. Os três Dockerfiles (`data-ingest`, `data-transform`, `data-quality`) foram reescritos pro padrão oficial do `uv` (`docs/guides/integration/docker.md`): sync inicial só com `pyproject.toml`/`uv.lock` da raiz via bind-mount (`--frozen --no-install-workspace`, sem precisar do `pyproject.toml` de nenhum membro), depois `COPY . /app` do repo inteiro e um `uv sync --locked --package <nome>` final — sem lista nenhuma pra manter.
6. **3 bugs de SQL nos marts dbt**, todos peculiaridades do ClickHouse:
   - `incidents_by_ic`: `toStartOfInterval` exige que o argumento de intervalo seja constante — não aceita a coluna `window_hours` vinda de um `arrayJoin`. Reescrito como `UNION ALL` de 3 selects com literal.
   - `p4_sequences_by_ci`: `partition_by`/`order_by` da config referenciavam `opened_at`, coluna que não existe no resultado final agregado.
   - `priority_changes_log`: usava `lag()` (não existe no ClickHouse; o equivalente é `lagInFrame()`).
7. **`data-quality` sem `pydantic-settings` declarado** em `pyproject.toml`, embora `settings.py` o use — só não quebrava localmente porque a dependência vinha transitiva de outro pacote do workspace uv compartilhado.
8. **Argo/Emissary não conseguia resolver o `ENTRYPOINT`** da imagem `data-quality` (só `args` estava declarado) porque o registry Gitea interno não responde no HTTPS que o executor tenta usar pra introspecção. Corrigido declarando `command` explicitamente no `WorkflowTemplate`.
9. **Kubernetes injeta `CLICKHOUSE_PORT` automaticamente** (do Service `clickhouse` no namespace, como uma URL) em todo pod do `ns: data` — colidia com o campo `clickhouse_port: int` que o `Settings` do data-quality tinha antes. `podSpecPatch: enableServiceLinks: false` no `WorkflowTemplate` **não teve efeito** (não é aplicado quando o Workflow é criado via `workflowTemplateRef` nesta versão do Argo). O fix definitivo, saído de revisão de código: em vez de 5 campos separados (`host`/`port`/`database`/`user`/`password`) remontados em `context.py`, `Settings` passou a receber uma `clickhouse_url` já pronta — mesma ideia do `CLICKHOUSE_MIGRATE_URL` que o Job de migration já usava. Sem um campo chamado `CLICKHOUSE_PORT`, não há nome pra colidir.

Além desses, duas expectations do GE (`ExpectColumnValuesToBeUnique`, `ExpectColumnPairValuesAToBeGreaterThanB`) falhavam silenciosamente contra ClickHouse — o motor genérico de SQL do GX gera `CAST(1, 'Decimal(None, None)')` internamente, e o ClickHouse exige precisão explícita em `Decimal`. Substituídas por `UnexpectedRowsExpectation` com SQL direto (`GROUP BY ... HAVING count(*) > 1` / `WHERE received_at < opened_at`), que não passa por esse caminho de código.

E dois testes dbt encontraram dado real incorreto nos marts (não infra, dado): `kpi_monthly_state.breach_rate` pode ser `NULL` por design (bucket sem incidents contados no KPI — divisão por zero via `nullIf`), então o teste `not_null` estava errado, não o dado — removido do `_schema.yml`. E `priority_changes_log` tinha uma linha espúria por ticket (`severity_from = 0`) porque `lagInFrame()` do ClickHouse retorna o default do tipo (0) na primeira linha de cada partição em vez de `NULL` como o `LAG()` padrão — corrigido filtrando por `row_number() > 1` em vez de confiar em `prev_severity IS NOT NULL`.

**Data Docs (achado à parte, fora da contagem de 9 acima):** `_upload_data_docs` nunca falhava, mas também nunca fazia nada — o contexto GX efêmero não tinha nenhum Data Docs site configurado, então `build_data_docs()` não tinha onde escrever e o diretório temporário ficava vazio silenciosamente (sem exceção, sem warning). Corrigido registrando um site `TupleFilesystemStoreBackend` local apontando pro próprio diretório temporário antes de chamar `build_data_docs`. Confirmado localmente: HTML completo (index, expectations, validations, assets estáticos) gerado e enviado pro MinIO.

**Conclusão:** o mecanismo funciona — GE bloqueou corretamente a DAG enquanto as duas expectations quebradas retornavam falso-negativo, e depois dos fixes a suite `critical` passa 100% sobre dado real. Todos os bugs eram de infraestrutura/SQL, não de lógica de negócio.
