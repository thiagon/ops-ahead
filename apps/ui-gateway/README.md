# ui-gateway

Fronteira HTTP do `ns: ui`. Um processo, um host (`gateway.ops-ahead.localtest.me`):

- webhooks autenticados → `events.raw.{alert,monitor}`
- `POST /analyses` / `GET /analyses/{id}` / MCP `/mcp/{tenant}` → `trigger.ml` / `trigger.data`, status no Postgres

## `POST /analyses`

Corpo discriminado pelo campo `analysis`. Responde `202 {"id": "<uuid>"}` na hora —
grava `pending` no database `gateway` e publica em Kafka. KEDA escala o consumer de 0 pra 1.

| `analysis` | Campos obrigatórios | O que roda |
|---|---|---|
| `volume_forecast` | `train_end`, `validation_end`, `holdout_end` (datas `YYYY-MM-DD`) | Treino do modelo de previsão de volume (`ml-trainer`, `ns: ml`) |
| `breach_risk` | `train_end`, `validation_end`, `holdout_end` | Treino do modelo de risco de breach de OLA (`ml-trainer`, `ns: ml`) |
| `kpi_projection` | — | Projeção Monte Carlo dos KPIs (`ml-trainer`) |
| `external_event_detection` | — | Detector de evento externo (`ml-trainer`) |
| `data_refresh` | — | `dbt run` — materializa os marts (`data-runner`, `ns: data`) |
| `data_quality_check` | — | Suite Great Expectations `critical` (`data-runner`, `ns: data`) |

O UUID HTTP (`id`) viaja nas mensagens Kafka como `run_id`. Nenhum campo de
infraestrutura (namespace, tópico, nome do consumer) é aceito no payload.

```bash
curl -X POST http://gateway.ops-ahead.localtest.me/analyses \
  -H 'content-type: application/json' \
  -d '{
    "analysis": "volume_forecast",
    "train_end": "2025-09-30",
    "validation_end": "2025-10-31",
    "holdout_end": "2026-01-31"
  }'

curl -X POST http://gateway.ops-ahead.localtest.me/analyses \
  -H 'content-type: application/json' \
  -d '{"analysis": "data_quality_check"}'
```

## `GET /analyses/{id}`

```bash
curl http://gateway.ops-ahead.localtest.me/analyses/<id>
# {"id": "...", "status": "pending" | "running" | "succeeded" | "failed", ...}
```

Lê a tabela `analyses` no database `gateway` da instância `config-postgres`.
`pending` é o estado gravado no POST, antes de qualquer PATCH do consumer.
A resposta nunca consulta o Kubernetes.

## MCP

As mesmas operações de negócio como tools em `/mcp/{tenant}` (streamable HTTP,
modo stateless), no mesmo processo/porta. O tenant vem da URL — as tools nunca
aceitam `tenant` no payload, então uma conexão opera um cliente por vez.

Configuração (mapeamento, prazos, metas) grava cada documento publicado.
O GET de histórico mostra as 10 mais recentes; o restante fica no banco.
Para voltar a um antigo, o caller lê o histórico e faz um PUT novo.

Não viram tool: `PATCH /analyses/{id}` (consumer interno) e `POST /webhook/...`
(origem assina com HMAC).

## Desenvolvimento

```bash
npm install
npm run db:generate   # Prisma 7 client → src/generated/prisma
npm run dev           # node --watch, porta 3000
npm test              # unit + e2e (kafka/postgres fake)
npm run lint
```

Ver `.env.example` para a config completa.
