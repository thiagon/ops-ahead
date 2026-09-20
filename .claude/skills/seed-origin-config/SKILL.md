---
name: seed-origin-config
description: >-
  Publish origin configuration (source, mapping, deadlines, KPI targets) through
  the ops-ahead-gateway MCP. Use when seeding ServiceNow/locaweb rules, publishing
  a mapping, registering a source, setting deadlines or targets, or when the user
  mentions seed_config — never run scripts/seed_config.py.
---

# Seed origin config via MCP

Do not run `scripts/seed_config.py` or `PUT /rules/*`. The gateway MCP is the producer.

Namespace: `project-0-ops_ahead-ops-ahead-gateway` (URL tenant is `locaweb`; tools never take `tenant`).

Discover the tool schema with `GetDynamicTools` before `CallDynamicTool`. If the namespace is `needsAuth`, call `mcp_auth` first. Always set `mcpDetails.description` on each call.

## Sequence

1. `list_sources` — skip register if `service_now` already exists with intake `alert`.
2. `register_source` `{ source: "service_now", intake: "alert" }` if missing or still `monitor`. Re-registering mints a new secret unless you pass the current one; give any new secret to the user, never commit it.
3. `set_mapping` with the payload in [servicenow.md](servicenow.md).
4. `set_deadlines` and `set_targets` from the same file (tenant-scoped, no `source`).
5. Confirm with `get_mapping` / `get_deadlines` / `get_targets`.

`set_mapping` answers 404 until the source is registered. 202 means accepted on the bus, not applied in ClickHouse.

## Mapping contract

Follow `apps/ui-gateway/src/services/rules/schema.ts`, not a cached MCP schema.

- Bindings are an **object** keyed by bronze column, not `{field, path}[]`.
- Alert required: `external_id`, `opened_at`, `severity`, `status`, `title`. Monitor required: `external_id`, `started_at`, `condition`, `entity_id`. Omit columns the origin does not send.
- Paths are dotted into the origin body as the webhook stored it (verbatim JSON). No `payload.` prefix unless the origin wraps the record.
- `labels` is either a path to a map or `[{ key, path }, …]` joined into bronze `labels`. Gold reads `labels['product']` and `labels['category']`.
- Dictionary keys are origin values; targets are domain enums (`automatic`/`manual`, `open`/`closed`, `"1"`–`"5"`). Do not put ServiceNow strings in the target enum.
- `acknowledged_at` is optional origin; silver derives it when bronze is null. Do not invent a path.
- Mapping `version` becomes `dictionary_version` on the bronze row. Bronze `version` is the translated contract (`v1`), stamped by ingest.

For a new origin, bind the Table API / webhook field names the origin actually sends. [servicenow.md](servicenow.md) is only the Locaweb ServiceNow default (`notebooks/events_dataset.ipynb` is the Locaweb → ServiceNow half).
