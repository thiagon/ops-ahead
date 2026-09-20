-- CreateTable
CREATE TABLE "mappings" (
    "id" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "intake" "Intake" NOT NULL,
    "dictionary_version" TEXT NOT NULL,
    "bindings" JSONB NOT NULL,
    "mappings" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deadlines" (
    "id" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deadlines" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deadlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "targets" (
    "id" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "targets" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mappings_tenant_id_source_created_at_idx" ON "mappings"("tenant_id", "source", "created_at");

-- CreateIndex
CREATE INDEX "deadlines_tenant_id_created_at_idx" ON "deadlines"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "targets_tenant_id_created_at_idx" ON "targets"("tenant_id", "created_at");
