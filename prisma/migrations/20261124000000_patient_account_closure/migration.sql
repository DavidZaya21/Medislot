-- Preserve every existing row; no historical closures or credentials are fabricated.
ALTER TABLE "User" ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "closureRequestId" UUID;
CREATE UNIQUE INDEX "User_closureRequestId_key" ON "User"("closureRequestId");
