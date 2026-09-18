-- Closed vocabularies the registry already used as text. One Status for every
-- row: leftover `paused` maps to inactive; dictionary `draft`/`published`
-- become inactive/active.

UPDATE "config_origins" SET "status" = 'inactive' WHERE "status" = 'paused';
UPDATE "config_dictionary_versions" SET "status" = 'inactive' WHERE "status" = 'draft';
UPDATE "config_dictionary_versions" SET "status" = 'active' WHERE "status" = 'published';

CREATE TYPE "Status" AS ENUM ('active', 'inactive', 'archived');
CREATE TYPE "Intake" AS ENUM ('monitor', 'alert');

ALTER TABLE "config_origins" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "config_origins"
  ALTER COLUMN "status" TYPE "Status"
  USING ("status"::text)::"Status";
ALTER TABLE "config_origins" ALTER COLUMN "status" SET DEFAULT 'inactive';

ALTER TABLE "config_origins"
  ALTER COLUMN "intake" TYPE "Intake"
  USING ("intake"::text)::"Intake";

ALTER TABLE "config_tenants" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "config_tenants"
  ALTER COLUMN "status" TYPE "Status"
  USING ("status"::text)::"Status";
ALTER TABLE "config_tenants" ALTER COLUMN "status" SET DEFAULT 'active';

ALTER TABLE "config_field_bindings" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "config_field_bindings"
  ALTER COLUMN "status" TYPE "Status"
  USING ("status"::text)::"Status";
ALTER TABLE "config_field_bindings" ALTER COLUMN "status" SET DEFAULT 'active';

ALTER TABLE "config_mappings" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "config_mappings"
  ALTER COLUMN "status" TYPE "Status"
  USING ("status"::text)::"Status";
ALTER TABLE "config_mappings" ALTER COLUMN "status" SET DEFAULT 'active';

ALTER TABLE "config_dictionary_versions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "config_dictionary_versions"
  ALTER COLUMN "status" TYPE "Status"
  USING ("status"::text)::"Status";
ALTER TABLE "config_dictionary_versions" ALTER COLUMN "status" SET DEFAULT 'inactive';

ALTER TABLE "config_deadlines" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "config_deadlines"
  ALTER COLUMN "status" TYPE "Status"
  USING ("status"::text)::"Status";
ALTER TABLE "config_deadlines" ALTER COLUMN "status" SET DEFAULT 'active';

ALTER TABLE "config_kpi_targets" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "config_kpi_targets"
  ALTER COLUMN "status" TYPE "Status"
  USING ("status"::text)::"Status";
ALTER TABLE "config_kpi_targets" ALTER COLUMN "status" SET DEFAULT 'active';
