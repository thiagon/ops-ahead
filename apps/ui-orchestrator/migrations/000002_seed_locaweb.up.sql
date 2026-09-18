-- The state the pipeline runs on today, as it lives in files next to the
-- consumers: apps/data-ingest/dictionaries/locaweb/itsm.v1.json, the field
-- reads in apps/data-ingest/src/sources/itsm.py, the dbt seeds
-- tenant_deadlines.csv and tenant_kpi_targets.csv, and the gateway's origin
-- registry. Those files stay until each consumer reads the config.* topics.

INSERT INTO config_origin (tenant_id, source, intake, envelope_version, enabled, secret_created_at)
VALUES ('locaweb', 'itsm', 'alert', 'v1', TRUE, now());

INSERT INTO config_field_binding (tenant_id, source, field, path) VALUES
    ('locaweb', 'itsm', 'external_id', 'ticket_number'),
    ('locaweb', 'itsm', 'opened_at', 'opened_at'),
    ('locaweb', 'itsm', 'acknowledged_at', NULL),
    ('locaweb', 'itsm', 'resolved_at', 'resolved_at'),
    ('locaweb', 'itsm', 'closed_at', 'closed_at'),
    ('locaweb', 'itsm', 'severity', 'priority_code'),
    ('locaweb', 'itsm', 'status', 'status'),
    ('locaweb', 'itsm', 'entity_id', 'configuration_item'),
    ('locaweb', 'itsm', 'title', 'short_description'),
    ('locaweb', 'itsm', 'description', NULL),
    ('locaweb', 'itsm', 'owner', 'assignment_group'),
    ('locaweb', 'itsm', 'reported_by', 'opened_by'),
    ('locaweb', 'itsm', 'parent_id', 'parent_incident'),
    ('locaweb', 'itsm', 'resolution_code', 'status'),
    ('locaweb', 'itsm', 'resolution_summary', 'resolution'),
    ('locaweb', 'itsm', 'labels', NULL),
    ('locaweb', 'itsm', 'source_url', NULL);

INSERT INTO config_mapping (id, tenant_id, source, mapping_field, from_value, to_value) VALUES
    ('3a30d2f3-0e99-4775-a1e7-995b7386d7b6', 'locaweb', 'itsm', 'status', 'Aguardando Problema', 'waiting'),
    ('09c92368-17d2-418f-9f2a-2fc55d691a69', 'locaweb', 'itsm', 'status', 'Encerrado', 'closed'),
    ('3df787c1-abff-49b2-ac06-12713bdc9a93', 'locaweb', 'itsm', 'status', 'Encerrado Automaticamente', 'closed'),
    ('a4e2302f-c735-48d1-a9eb-f2aab9e98fab', 'locaweb', 'itsm', 'status', 'Sem Intervenção', 'closed'),
    ('5c6f3300-8649-4c72-804e-b51f2aa17ee0', 'locaweb', 'itsm', 'reported_by', 'Monitoramento', 'automatic'),
    ('0d638490-2336-4141-9bc8-6cfddacd51dd', 'locaweb', 'itsm', 'reported_by', 'Manual', 'manual'),
    ('bda59789-1114-4e4f-a362-2296570dfeef', 'locaweb', 'itsm', 'resolution_code', 'Sem Intervenção', 'no_intervention'),
    ('5b55bd1c-de63-46bb-a5ea-3e84b4ade3d0', 'locaweb', 'itsm', 'resolution_code', 'Encerrado Automaticamente', 'auto_resolved');

INSERT INTO config_dictionary_version (tenant_id, source, version, status)
VALUES ('locaweb', 'itsm', 'v1', 'published');

INSERT INTO config_deadline (tenant_id, severity, deadline_seconds) VALUES
    ('locaweb', 1, 14400),
    ('locaweb', 2, 14400),
    ('locaweb', 3, 43200),
    ('locaweb', 4, 86400),
    ('locaweb', 5, 345600);

INSERT INTO config_kpi_target (tenant_id, kpi_group, max_breaches, achievement_pct) VALUES
    ('locaweb', 'p1_p2', 30, 150),
    ('locaweb', 'p1_p2', 35, 125),
    ('locaweb', 'p1_p2', 39, 100),
    ('locaweb', 'p1_p2', 45, 75),
    ('locaweb', 'p1_p2', 53, 50),
    ('locaweb', 'p1_p2', 999999, 0),
    ('locaweb', 'p3', 200, 150),
    ('locaweb', 'p3', 230, 125),
    ('locaweb', 'p3', 263, 100),
    ('locaweb', 'p3', 290, 75),
    ('locaweb', 'p3', 320, 50),
    ('locaweb', 'p3', 999999, 0);
