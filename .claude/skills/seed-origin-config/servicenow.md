# Default Locaweb × ServiceNow payloads

From `notebooks/events_dataset.ipynb` (Locaweb CSV → ServiceNow Table API). Webhook body is that record at the root. `service_now` is intake `alert`.

## `set_mapping`

```json
{
  "source": "service_now",
  "intake": "alert",
  "version": "v1",
  "bindings": {
    "external_id": "number",
    "opened_at": "opened_at",
    "severity": "priority",
    "status": "state",
    "title": "short_description",
    "resolved_at": "resolved_at",
    "closed_at": "closed_at",
    "entity_id": "cmdb_ci",
    "owner": "assignment_group",
    "reported_by": "opened_by",
    "parent_id": "parent_incident",
    "resolution_code": "close_code",
    "resolution_summary": "close_notes",
    "labels": [
      { "key": "product", "path": "u_product" },
      { "key": "category", "path": "category" },
      { "key": "subcategory", "path": "subcategory" }
    ]
  },
  "mappings": {
    "status": {
      "1": "open",
      "2": "in_progress",
      "3": "waiting",
      "6": "resolved",
      "7": "closed",
      "8": "canceled"
    },
    "severity": { "1": "1", "2": "2", "3": "3", "4": "4", "5": "5" },
    "reported_by": {
      "monitoring.system": "automatic",
      "itsm.operator": "manual"
    },
    "resolution_code": {
      "No Intervention Required": "no_intervention"
    }
  }
}
```

`state` 1/2/3/6/7/8 is ServiceNow. The notebook already folded "Sem Intervenção" into `7`; KPI meaning is `close_code`.

## `set_deadlines`

P1/P2 ≤ 4h · P3 ≤ 12h · P4 ≤ 24h · P5 ≤ 96h.

```json
{
  "deadlines": [
    { "severity": 1, "seconds": 14400 },
    { "severity": 2, "seconds": 14400 },
    { "severity": 3, "seconds": 43200 },
    { "severity": 4, "seconds": 86400 },
    { "severity": 5, "seconds": 345600 }
  ]
}
```

## `set_targets`

```json
{
  "targets": [
    { "severities": [1, 2], "max_breaches": 5, "achievement_pct": 95 },
    { "severities": [3], "max_breaches": 10, "achievement_pct": 90 }
  ]
}
```
