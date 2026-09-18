ALTER TABLE "config_kpi_targets" ADD COLUMN IF NOT EXISTS "severities" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'config_kpi_targets' AND column_name = 'kpi_group'
  ) THEN
    UPDATE "config_kpi_targets" SET "severities" = ARRAY[1, 2] WHERE "kpi_group" = 'p1_p2';
    UPDATE "config_kpi_targets" SET "severities" = ARRAY[3] WHERE "kpi_group" = 'p3';
    DROP INDEX IF EXISTS "config_kpi_targets_tenant_id_kpi_group_achievement_pct_key";
    ALTER TABLE "config_kpi_targets" DROP CONSTRAINT IF EXISTS "config_kpi_targets_tenant_id_kpi_group_achievement_pct_key";
    ALTER TABLE "config_kpi_targets" DROP COLUMN "kpi_group";
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "config_kpi_targets_tenant_id_severities_achievement_pct_key" ON "config_kpi_targets"("tenant_id", "severities", "achievement_pct");
