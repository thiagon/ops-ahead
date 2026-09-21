# ui-frontend

Dashboard front end (`ns: ui`). React Router in framework mode: the loaders run on this app's
own server and query the ClickHouse gold layer directly — the browser never receives a database
credential.

The Ajustes screens (integrations, deadlines, KPI targets) read and write the gateway
(`GATEWAY_URL`), the same registry REST and MCP share. ClickHouse remains the source for
operational screens (panel, queue, manager).

## Development

```bash
npm install
npm run dev
```

The gateway must be reachable (`GATEWAY_URL`). This app does not seed configuration.

## Configuration

| Env | Meaning |
|-----|---------|
| `CLICKHOUSE_URL` | Whole connection in one URL, on the HTTP interface (`8123`) |
| `GATEWAY_URL` | Gateway from this process (cluster service, or the ingress host locally) |
| `PUBLIC_GATEWAY_URL` | External webhook base shown on the integration screen |
| `SERVICE_NAME` / `SERVICE_VERSION` | Reported by `/health` |

## Routes

- `/` — pick a tenant from the signed-in identity
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
