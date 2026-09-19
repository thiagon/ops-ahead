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
npm run db:seed   # optional: locaweb/service_now as Monitor
npm run dev
```

## Configuration

| Env | Meaning |
|-----|---------|
| `CLICKHOUSE_URL` | Whole connection in one URL, on the HTTP interface (`8123`) |
| `CONFIG_DATABASE_URL` | Postgres URL for the configuration registry this app owns |
| `PUBLIC_GATEWAY_URL` | External webhook base shown on the integration screen |
| `SERVICE_NAME` / `SERVICE_VERSION` | Reported by `/health` |

## Routes

- `/` — enter tenant slug
- `/:tenant` — N1/N2 panel
- `/:tenant/manager` — tactical view
- `/:tenant/queue` — prioritized queue
- `/:tenant/integrations` · `/:tenant/integrations/:source` · `/:tenant/targets` · `/:tenant/deadlines` — Ajustes
- `/health` — status, service, version, uptime
- `/metrics` — Prometheus text format

## Server-only modules

`app/*.server.ts` and `app/features/**/*.server.ts` never reach the client bundle.
`test/server-only.test.ts` asserts both halves: no client-eligible module imports them, and the
built `build/client` output carries no ClickHouse code, gold table name, or credential.
