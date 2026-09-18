ALTER TABLE "config_tenants" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'config_tenants' AND column_name = 'active'
  ) THEN
    UPDATE "config_tenants" SET "status" = 'inactive' WHERE "active" = false;
    ALTER TABLE "config_tenants" DROP COLUMN "active";
  END IF;
END $$;
