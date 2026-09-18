ALTER TABLE "config_origins" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'config_origins' AND column_name = 'enabled'
  ) THEN
    UPDATE "config_origins" SET "status" = 'paused' WHERE "enabled" = false;
    ALTER TABLE "config_origins" DROP COLUMN "enabled";
  END IF;
END $$;

ALTER TABLE "config_field_bindings" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "config_mappings" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "config_deadlines" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "config_kpi_targets" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';
