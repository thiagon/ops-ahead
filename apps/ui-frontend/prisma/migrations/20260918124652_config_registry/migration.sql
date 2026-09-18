-- CreateTable
CREATE TABLE "config_origin" (
    "tenant_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "intake" TEXT NOT NULL,
    "envelope_version" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "secret_created_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_origin_pkey" PRIMARY KEY ("tenant_id","source")
);

-- CreateTable
CREATE TABLE "config_field_binding" (
    "tenant_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "path" TEXT,

    CONSTRAINT "config_field_binding_pkey" PRIMARY KEY ("tenant_id","source","field")
);

-- CreateTable
CREATE TABLE "config_mapping" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mapping_field" TEXT NOT NULL,
    "from_value" TEXT NOT NULL,
    "to_value" TEXT NOT NULL,

    CONSTRAINT "config_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_dictionary_version" (
    "tenant_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "config_dictionary_version_pkey" PRIMARY KEY ("tenant_id","source")
);

-- CreateTable
CREATE TABLE "config_deadline" (
    "tenant_id" TEXT NOT NULL,
    "severity" SMALLINT NOT NULL,
    "deadline_seconds" INTEGER NOT NULL,

    CONSTRAINT "config_deadline_pkey" PRIMARY KEY ("tenant_id","severity")
);

-- CreateTable
CREATE TABLE "config_kpi_target" (
    "tenant_id" TEXT NOT NULL,
    "kpi_group" TEXT NOT NULL,
    "max_breaches" INTEGER NOT NULL,
    "achievement_pct" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "config_kpi_target_pkey" PRIMARY KEY ("tenant_id","kpi_group","achievement_pct")
);

-- CreateTable
CREATE TABLE "config_revision" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "config_key" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "payload" JSONB,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "config_mapping_tenant_id_source_mapping_field_from_value_key" ON "config_mapping"("tenant_id", "source", "mapping_field", "from_value");

-- CreateIndex
CREATE INDEX "config_revision_tenant_id_at_idx" ON "config_revision"("tenant_id", "at" DESC);

-- AddForeignKey
ALTER TABLE "config_field_binding" ADD CONSTRAINT "config_field_binding_tenant_id_source_fkey" FOREIGN KEY ("tenant_id", "source") REFERENCES "config_origin"("tenant_id", "source") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_mapping" ADD CONSTRAINT "config_mapping_tenant_id_source_fkey" FOREIGN KEY ("tenant_id", "source") REFERENCES "config_origin"("tenant_id", "source") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_dictionary_version" ADD CONSTRAINT "config_dictionary_version_tenant_id_source_fkey" FOREIGN KEY ("tenant_id", "source") REFERENCES "config_origin"("tenant_id", "source") ON DELETE CASCADE ON UPDATE CASCADE;
