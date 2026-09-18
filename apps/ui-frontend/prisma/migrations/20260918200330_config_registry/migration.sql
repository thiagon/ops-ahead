-- CreateEnum
CREATE TYPE "Status" AS ENUM ('active', 'inactive', 'archived');

-- CreateEnum
CREATE TYPE "Intake" AS ENUM ('monitor', 'alert');

-- CreateTable
CREATE TABLE "config_tenants" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_origins" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "intake" "Intake" NOT NULL,
    "envelope_version" TEXT NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'inactive',
    "secret_created_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_origins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_field_bindings" (
    "id" SERIAL NOT NULL,
    "origin_id" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "path" TEXT,
    "status" "Status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_field_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_mappings" (
    "id" SERIAL NOT NULL,
    "origin_id" INTEGER NOT NULL,
    "mapping_field" TEXT NOT NULL,
    "from_value" TEXT NOT NULL,
    "to_value" TEXT NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_dictionary_versions" (
    "id" SERIAL NOT NULL,
    "origin_id" INTEGER NOT NULL,
    "version" TEXT NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'inactive',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_dictionary_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_deadlines" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "severity" SMALLINT NOT NULL,
    "deadline_seconds" INTEGER NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_deadlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_kpi_targets" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "severities" INTEGER[],
    "max_breaches" INTEGER NOT NULL,
    "achievement_pct" DECIMAL(5,2) NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_kpi_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_revisions" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "domain" TEXT NOT NULL,
    "config_key" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "config_tenants_slug_key" ON "config_tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "config_origins_tenant_id_source_key" ON "config_origins"("tenant_id", "source");

-- CreateIndex
CREATE UNIQUE INDEX "config_field_bindings_origin_id_field_key" ON "config_field_bindings"("origin_id", "field");

-- CreateIndex
CREATE UNIQUE INDEX "config_mappings_origin_id_mapping_field_from_value_key" ON "config_mappings"("origin_id", "mapping_field", "from_value");

-- CreateIndex
CREATE UNIQUE INDEX "config_dictionary_versions_origin_id_key" ON "config_dictionary_versions"("origin_id");

-- CreateIndex
CREATE UNIQUE INDEX "config_deadlines_tenant_id_severity_key" ON "config_deadlines"("tenant_id", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "config_kpi_targets_tenant_id_severities_achievement_pct_key" ON "config_kpi_targets"("tenant_id", "severities", "achievement_pct");

-- AddForeignKey
ALTER TABLE "config_origins" ADD CONSTRAINT "config_origins_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "config_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_field_bindings" ADD CONSTRAINT "config_field_bindings_origin_id_fkey" FOREIGN KEY ("origin_id") REFERENCES "config_origins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_mappings" ADD CONSTRAINT "config_mappings_origin_id_fkey" FOREIGN KEY ("origin_id") REFERENCES "config_origins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_dictionary_versions" ADD CONSTRAINT "config_dictionary_versions_origin_id_fkey" FOREIGN KEY ("origin_id") REFERENCES "config_origins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_deadlines" ADD CONSTRAINT "config_deadlines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "config_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_kpi_targets" ADD CONSTRAINT "config_kpi_targets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "config_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_revisions" ADD CONSTRAINT "config_revisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "config_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
