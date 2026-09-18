-- The registry behind the configuration screens. Postgres holds who changed
-- what and the version before it; the consumers read the current state from
-- the compacted config.* topics, never from here.

CREATE TABLE config_origin (
    tenant_id        TEXT        NOT NULL,
    source           TEXT        NOT NULL,
    intake           TEXT        NOT NULL CHECK (intake IN ('alert', 'monitor')),
    envelope_version TEXT        NOT NULL,
    enabled          BOOLEAN     NOT NULL DEFAULT TRUE,
    secret_created_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, source)
);

-- Where each field of the translated contract is read in the origin's payload
-- (contracts/field-binding.schema.json).
CREATE TABLE config_field_binding (
    tenant_id TEXT NOT NULL,
    source    TEXT NOT NULL,
    field     TEXT NOT NULL,
    path      TEXT,
    PRIMARY KEY (tenant_id, source, field),
    FOREIGN KEY (tenant_id, source) REFERENCES config_origin (tenant_id, source) ON DELETE CASCADE
);

-- One origin value mapped to one domain value. Several origin values may land
-- on the same domain value, never the reverse — hence the key on the origin
-- side (contracts/translation-dictionary.schema.json).
CREATE TABLE config_mapping (
    id            UUID PRIMARY KEY,
    tenant_id     TEXT NOT NULL,
    source        TEXT NOT NULL,
    mapping_field TEXT NOT NULL,
    from_value    TEXT NOT NULL,
    to_value      TEXT NOT NULL,
    UNIQUE (tenant_id, source, mapping_field, from_value),
    FOREIGN KEY (tenant_id, source) REFERENCES config_origin (tenant_id, source) ON DELETE CASCADE
);

CREATE TABLE config_dictionary_version (
    tenant_id TEXT        NOT NULL,
    source    TEXT        NOT NULL,
    version   TEXT        NOT NULL,
    status    TEXT        NOT NULL CHECK (status IN ('published', 'draft')),
    PRIMARY KEY (tenant_id, source),
    FOREIGN KEY (tenant_id, source) REFERENCES config_origin (tenant_id, source) ON DELETE CASCADE
);

CREATE TABLE config_deadline (
    tenant_id        TEXT     NOT NULL,
    severity         SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 5),
    deadline_seconds INTEGER  NOT NULL CHECK (deadline_seconds > 0),
    PRIMARY KEY (tenant_id, severity)
);

-- A group carries one row per achievement band, so the band is part of the key
-- (apps/data-runner/seeds/tenant_kpi_targets.csv).
CREATE TABLE config_kpi_target (
    tenant_id       TEXT    NOT NULL,
    kpi_group       TEXT    NOT NULL,
    max_breaches    INTEGER NOT NULL CHECK (max_breaches >= 0),
    achievement_pct NUMERIC(5, 2) NOT NULL CHECK (achievement_pct >= 0),
    PRIMARY KEY (tenant_id, kpi_group, achievement_pct)
);

-- Append-only: a correction is a new row, so the previous payload is what
-- rollback restores.
CREATE TABLE config_revision (
    id         UUID PRIMARY KEY,
    tenant_id  TEXT        NOT NULL,
    domain     TEXT        NOT NULL CHECK (domain IN ('origin', 'dictionary', 'deadline', 'kpi_target')),
    config_key TEXT        NOT NULL,
    summary    TEXT        NOT NULL,
    author     TEXT        NOT NULL,
    payload    JSONB       NOT NULL,
    at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX config_revision_tenant_at_idx ON config_revision (tenant_id, at DESC);
