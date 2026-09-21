-- Provenance columns the schema already declares (analysis / tenant / trigger /
-- parent). They were added to schema.prisma without a migration, so a database
-- that only ever ran migrate has the old analyses shape and Prisma fails on
-- findMany with P2022.

CREATE TYPE "AnalysisTrigger" AS ENUM ('manual', 'scheduled', 'chained');

ALTER TABLE "analyses" ADD COLUMN "analysis" TEXT;
UPDATE "analyses" SET "analysis" = 'unknown' WHERE "analysis" IS NULL;
ALTER TABLE "analyses" ALTER COLUMN "analysis" SET NOT NULL;

ALTER TABLE "analyses" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "analyses" ADD COLUMN "trigger" "AnalysisTrigger" NOT NULL DEFAULT 'manual';
ALTER TABLE "analyses" ADD COLUMN "parent_id" TEXT;

ALTER TABLE "analyses"
  ADD CONSTRAINT "analyses_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "analyses"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "analyses_trigger_created_at_idx" ON "analyses"("trigger", "created_at");
CREATE INDEX "analyses_tenant_id_created_at_idx" ON "analyses"("tenant_id", "created_at");
CREATE INDEX "analyses_analysis_created_at_idx" ON "analyses"("analysis", "created_at");
