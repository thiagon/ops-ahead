-- The run key identifies a run, so it is looked up by hash when a chained POST
-- presents it, not only by id on a PATCH: hence the unique.
ALTER TABLE "analyses" RENAME COLUMN "update_key_hash" TO "run_key_hash";
CREATE UNIQUE INDEX "analyses_run_key_hash_key" ON "analyses"("run_key_hash");

CREATE TYPE "ApiKeyKind" AS ENUM ('scheduler');

CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "kind" "ApiKeyKind" NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,
    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "api_keys_hash_key" ON "api_keys"("hash");
