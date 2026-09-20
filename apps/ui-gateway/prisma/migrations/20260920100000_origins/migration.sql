-- CreateEnum
CREATE TYPE "Intake" AS ENUM ('alert', 'monitor');

-- CreateTable
CREATE TABLE "origins" (
    "tenant_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "intake" "Intake" NOT NULL,
    "encrypted_secret" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "origins_pkey" PRIMARY KEY ("tenant_id","source")
);
