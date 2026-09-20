-- CreateEnum
CREATE TYPE "Intake" AS ENUM ('alert', 'monitor');

-- CreateTable
CREATE TABLE "sources" (
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intake" "Intake" NOT NULL,
    "encrypted_secret" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("tenant_id","name")
);
