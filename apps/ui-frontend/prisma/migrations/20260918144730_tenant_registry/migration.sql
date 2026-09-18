-- Plural table names, config_tenants (id + slug + name), numeric FKs, and a
-- surrogate id on every table (natural keys become UNIQUE).

-- ── rename singular → plural ────────────────────────────────────────────────

ALTER TABLE "config_origin" RENAME TO "config_origins";
ALTER TABLE "config_field_binding" RENAME TO "config_field_bindings";
ALTER TABLE "config_mapping" RENAME TO "config_mappings";
ALTER TABLE "config_dictionary_version" RENAME TO "config_dictionary_versions";
ALTER TABLE "config_deadline" RENAME TO "config_deadlines";
ALTER TABLE "config_kpi_target" RENAME TO "config_kpi_targets";
ALTER TABLE "config_revision" RENAME TO "config_revisions";

ALTER INDEX "config_origin_pkey" RENAME TO "config_origins_pkey";
ALTER INDEX "config_field_binding_pkey" RENAME TO "config_field_bindings_pkey";
ALTER INDEX "config_mapping_pkey" RENAME TO "config_mappings_pkey";
ALTER INDEX "config_dictionary_version_pkey" RENAME TO "config_dictionary_versions_pkey";
ALTER INDEX "config_deadline_pkey" RENAME TO "config_deadlines_pkey";
ALTER INDEX "config_kpi_target_pkey" RENAME TO "config_kpi_targets_pkey";
ALTER INDEX "config_revision_pkey" RENAME TO "config_revisions_pkey";
ALTER INDEX "config_mapping_tenant_id_source_mapping_field_from_value_key" RENAME TO "config_mappings_old_natural_key";
ALTER INDEX "config_revision_tenant_id_at_idx" RENAME TO "config_revisions_tenant_id_at_idx";

ALTER TABLE "config_field_bindings" RENAME CONSTRAINT "config_field_binding_tenant_id_source_fkey" TO "config_field_bindings_old_fkey";
ALTER TABLE "config_mappings" RENAME CONSTRAINT "config_mapping_tenant_id_source_fkey" TO "config_mappings_old_fkey";
ALTER TABLE "config_dictionary_versions" RENAME CONSTRAINT "config_dictionary_version_tenant_id_source_fkey" TO "config_dictionary_versions_old_fkey";

-- ── tenants ─────────────────────────────────────────────────────────────────

CREATE TABLE "config_tenants" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "config_tenants_slug_key" ON "config_tenants"("slug");

INSERT INTO "config_tenants" ("slug", "name", "active")
SELECT DISTINCT tenant_id, tenant_id, true
FROM (
    SELECT "tenant_id" FROM "config_origins"
    UNION
    SELECT "tenant_id" FROM "config_deadlines"
    UNION
    SELECT "tenant_id" FROM "config_kpi_targets"
    UNION
    SELECT "tenant_id" FROM "config_revisions"
) AS existing;
-- name starts as the old text key; seed overwrites it with the display label.

-- ── origins: surrogate id + tenant_id int ───────────────────────────────────

ALTER TABLE "config_field_bindings" DROP CONSTRAINT "config_field_bindings_old_fkey";
ALTER TABLE "config_mappings" DROP CONSTRAINT "config_mappings_old_fkey";
ALTER TABLE "config_dictionary_versions" DROP CONSTRAINT "config_dictionary_versions_old_fkey";

ALTER TABLE "config_origins" ADD COLUMN "id" SERIAL;
ALTER TABLE "config_origins" ADD COLUMN "tenant_id_new" INTEGER;

UPDATE "config_origins" o
SET "tenant_id_new" = t.id
FROM "config_tenants" t
WHERE t.slug = o."tenant_id";

ALTER TABLE "config_origins" DROP CONSTRAINT "config_origins_pkey";
ALTER TABLE "config_origins" DROP COLUMN "tenant_id";
ALTER TABLE "config_origins" RENAME COLUMN "tenant_id_new" TO "tenant_id";
ALTER TABLE "config_origins" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "config_origins" ADD CONSTRAINT "config_origins_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "config_origins_tenant_id_source_key" ON "config_origins"("tenant_id", "source");
ALTER TABLE "config_origins" ADD CONSTRAINT "config_origins_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "config_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── field_bindings → origin_id ──────────────────────────────────────────────

ALTER TABLE "config_field_bindings" ADD COLUMN "id" SERIAL;
ALTER TABLE "config_field_bindings" ADD COLUMN "origin_id" INTEGER;

UPDATE "config_field_bindings" b
SET "origin_id" = o.id
FROM "config_origins" o
JOIN "config_tenants" t ON t.id = o."tenant_id"
WHERE t.slug = b."tenant_id" AND o."source" = b."source";

ALTER TABLE "config_field_bindings" DROP CONSTRAINT "config_field_bindings_pkey";
ALTER TABLE "config_field_bindings" DROP COLUMN "tenant_id";
ALTER TABLE "config_field_bindings" DROP COLUMN "source";
ALTER TABLE "config_field_bindings" ALTER COLUMN "origin_id" SET NOT NULL;
ALTER TABLE "config_field_bindings" ADD CONSTRAINT "config_field_bindings_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "config_field_bindings_origin_id_field_key" ON "config_field_bindings"("origin_id", "field");
ALTER TABLE "config_field_bindings" ADD CONSTRAINT "config_field_bindings_origin_id_fkey" FOREIGN KEY ("origin_id") REFERENCES "config_origins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── mappings → origin_id + int id ───────────────────────────────────────────

ALTER TABLE "config_mappings" ADD COLUMN "id_new" SERIAL;
ALTER TABLE "config_mappings" ADD COLUMN "origin_id" INTEGER;

UPDATE "config_mappings" m
SET "origin_id" = o.id
FROM "config_origins" o
JOIN "config_tenants" t ON t.id = o."tenant_id"
WHERE t.slug = m."tenant_id" AND o."source" = m."source";

DROP INDEX "config_mappings_old_natural_key";
ALTER TABLE "config_mappings" DROP CONSTRAINT "config_mappings_pkey";
ALTER TABLE "config_mappings" DROP COLUMN "id";
ALTER TABLE "config_mappings" DROP COLUMN "tenant_id";
ALTER TABLE "config_mappings" DROP COLUMN "source";
ALTER TABLE "config_mappings" RENAME COLUMN "id_new" TO "id";
ALTER TABLE "config_mappings" ALTER COLUMN "origin_id" SET NOT NULL;
ALTER TABLE "config_mappings" ADD CONSTRAINT "config_mappings_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "config_mappings_origin_id_mapping_field_from_value_key" ON "config_mappings"("origin_id", "mapping_field", "from_value");
ALTER TABLE "config_mappings" ADD CONSTRAINT "config_mappings_origin_id_fkey" FOREIGN KEY ("origin_id") REFERENCES "config_origins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── dictionary_versions → origin_id ─────────────────────────────────────────

ALTER TABLE "config_dictionary_versions" ADD COLUMN "id" SERIAL;
ALTER TABLE "config_dictionary_versions" ADD COLUMN "origin_id" INTEGER;

UPDATE "config_dictionary_versions" d
SET "origin_id" = o.id
FROM "config_origins" o
JOIN "config_tenants" t ON t.id = o."tenant_id"
WHERE t.slug = d."tenant_id" AND o."source" = d."source";

ALTER TABLE "config_dictionary_versions" DROP CONSTRAINT "config_dictionary_versions_pkey";
ALTER TABLE "config_dictionary_versions" DROP COLUMN "tenant_id";
ALTER TABLE "config_dictionary_versions" DROP COLUMN "source";
ALTER TABLE "config_dictionary_versions" ALTER COLUMN "origin_id" SET NOT NULL;
ALTER TABLE "config_dictionary_versions" ADD CONSTRAINT "config_dictionary_versions_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "config_dictionary_versions_origin_id_key" ON "config_dictionary_versions"("origin_id");
ALTER TABLE "config_dictionary_versions" ADD CONSTRAINT "config_dictionary_versions_origin_id_fkey" FOREIGN KEY ("origin_id") REFERENCES "config_origins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── deadlines ───────────────────────────────────────────────────────────────

ALTER TABLE "config_deadlines" ADD COLUMN "id" SERIAL;
ALTER TABLE "config_deadlines" ADD COLUMN "tenant_id_new" INTEGER;

UPDATE "config_deadlines" d
SET "tenant_id_new" = t.id
FROM "config_tenants" t
WHERE t.slug = d."tenant_id";

ALTER TABLE "config_deadlines" DROP CONSTRAINT "config_deadlines_pkey";
ALTER TABLE "config_deadlines" DROP COLUMN "tenant_id";
ALTER TABLE "config_deadlines" RENAME COLUMN "tenant_id_new" TO "tenant_id";
ALTER TABLE "config_deadlines" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "config_deadlines" ADD CONSTRAINT "config_deadlines_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "config_deadlines_tenant_id_severity_key" ON "config_deadlines"("tenant_id", "severity");
ALTER TABLE "config_deadlines" ADD CONSTRAINT "config_deadlines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "config_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── kpi_targets ─────────────────────────────────────────────────────────────

ALTER TABLE "config_kpi_targets" ADD COLUMN "id" SERIAL;
ALTER TABLE "config_kpi_targets" ADD COLUMN "tenant_id_new" INTEGER;

UPDATE "config_kpi_targets" k
SET "tenant_id_new" = t.id
FROM "config_tenants" t
WHERE t.slug = k."tenant_id";

ALTER TABLE "config_kpi_targets" DROP CONSTRAINT "config_kpi_targets_pkey";
ALTER TABLE "config_kpi_targets" DROP COLUMN "tenant_id";
ALTER TABLE "config_kpi_targets" RENAME COLUMN "tenant_id_new" TO "tenant_id";
ALTER TABLE "config_kpi_targets" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "config_kpi_targets" ADD CONSTRAINT "config_kpi_targets_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "config_kpi_targets_tenant_id_kpi_group_achievement_pct_key" ON "config_kpi_targets"("tenant_id", "kpi_group", "achievement_pct");
ALTER TABLE "config_kpi_targets" ADD CONSTRAINT "config_kpi_targets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "config_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── revisions: uuid id → serial ─────────────────────────────────────────────

ALTER TABLE "config_revisions" ADD COLUMN "id_new" SERIAL;
ALTER TABLE "config_revisions" ADD COLUMN "tenant_id_new" INTEGER;

UPDATE "config_revisions" r
SET "tenant_id_new" = t.id
FROM "config_tenants" t
WHERE t.slug = r."tenant_id";

ALTER TABLE "config_revisions" DROP CONSTRAINT "config_revisions_pkey";
ALTER TABLE "config_revisions" DROP COLUMN "id";
ALTER TABLE "config_revisions" DROP COLUMN "tenant_id";
ALTER TABLE "config_revisions" RENAME COLUMN "id_new" TO "id";
ALTER TABLE "config_revisions" RENAME COLUMN "tenant_id_new" TO "tenant_id";
ALTER TABLE "config_revisions" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "config_revisions" ADD CONSTRAINT "config_revisions_pkey" PRIMARY KEY ("id");
ALTER TABLE "config_revisions" ADD CONSTRAINT "config_revisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "config_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
