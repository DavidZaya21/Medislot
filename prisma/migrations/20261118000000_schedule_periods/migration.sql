-- Legacy/manual slots retain NULL: generation configuration and publisher
-- cannot safely be inferred. New publications always populate this relation.
CREATE TABLE "SchedulePeriod" (
  "id" SERIAL PRIMARY KEY,
  "doctorId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "workingWeekdays" INTEGER[] NOT NULL,
  "dailyStartTime" TEXT NOT NULL,
  "dailyEndTime" TEXT NOT NULL,
  "slotDurationMinutes" INTEGER NOT NULL,
  "excludedDates" TEXT[] NOT NULL,
  "removedSlotIds" INTEGER[] NOT NULL,
  "publishedById" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SchedulePeriod_doctorId_startDate_endDate_idx" ON "SchedulePeriod"("doctorId", "startDate", "endDate");
ALTER TABLE "Calendar" ADD COLUMN "schedulePeriodId" INTEGER;
ALTER TABLE "Calendar" ADD CONSTRAINT "Calendar_schedulePeriodId_fkey"
  FOREIGN KEY ("schedulePeriodId") REFERENCES "SchedulePeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
