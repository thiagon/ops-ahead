-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

INSERT INTO "tenants" ("id", "updated_at")
SELECT "tenant_id", CURRENT_TIMESTAMP FROM "sources"
UNION
SELECT "tenant_id", CURRENT_TIMESTAMP FROM "deadlines"
UNION
SELECT "tenant_id", CURRENT_TIMESTAMP FROM "targets";

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "targets" ADD CONSTRAINT "targets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_tenant_id_source_fkey" FOREIGN KEY ("tenant_id", "source") REFERENCES "sources"("tenant_id", "name") ON DELETE RESTRICT ON UPDATE CASCADE;
