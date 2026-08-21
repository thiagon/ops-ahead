# ui-frontend

Dashboard front end (`ns: ui`). React Router in framework mode: the loaders run on this app's
own server and query the ClickHouse gold layer directly — the browser never receives a database
credential.

## Development

```bash
npm install
npm run dev
```

## Configuration

| Env | Meaning |
|-----|---------|
| `CLICKHOUSE_URL` | Whole connection in one URL, on the HTTP interface (`8123`) |
| `TENANT_ID` | The single tenant the screens read |
| `SERVICE_NAME` / `SERVICE_VERSION` | Reported by `/health` |

## Routes

- `/health` — status, service, version, uptime, same shape as the other `ns: ui` apps
- `/metrics` — Prometheus text format, on this app's own registry

## Server-only modules

`app/*.server.ts` never reaches the client bundle. `test/server-only.test.ts` asserts both halves:
no client-eligible module imports them, and the built `build/client` output carries no ClickHouse
code, gold table name, or credential.
