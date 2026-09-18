# ui-frontend

Dashboard front end (`ns: ui`). React Router in framework mode: the loaders run on this app's
own server and query the ClickHouse gold layer directly — the browser never receives a database
credential.

The Ajustes screens (integrations, deadlines, KPI targets) own their registry in Postgres via
Prisma (`prisma/`). Nothing else reads or writes that database.

## Development

```bash
# Registry Postgres — matches apps/ui-frontend/.env
docker run --rm -d --name ui-frontend-config-pg \
  -e POSTGRES_USER=config -e POSTGRES_PASSWORD=config -e POSTGRES_DB=config \
  -p 55432:5432 postgres:16-alpine

npm install
npm run db:migrate
npm run db:seed   # optional: locaweb/itsm as the pipeline runs today
npm run dev
```

## Configuration

| Env | Meaning |
|-----|---------|
| `CLICKHOUSE_URL` | Whole connection in one URL, on the HTTP interface (`8123`) |
| `CONFIG_DATABASE_URL` | Postgres URL for the configuration registry this app owns |
| `PUBLIC_GATEWAY_URL` | External webhook base shown on the integration screen |
| `SERVICE_NAME` / `SERVICE_VERSION` | Reported by `/health` |

The active tenant is a row in `config_tenants` (`slug` unique for URLs/ClickHouse,
`name` for display), not an env var. Seed with `npm run db:seed`.

## Routes

- `/` — Painel N1/N2
- `/painel-gestor` — visão tática
- `/fila` — fila priorizada
- `/integracoes` · `/integracoes/:source` · `/metas-e-prazos` — Ajustes (config registry)
- `/health` — status, service, version, uptime
- `/metrics` — Prometheus text format

## Server-only modules

`app/*.server.ts` and `app/features/**/*.server.ts` never reach the client bundle.
`test/server-only.test.ts` asserts both halves: no client-eligible module imports them, and the
built `build/client` output carries no ClickHouse code, gold table name, or credential.
