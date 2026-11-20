-- Only explicitly approved legacy mappings and already canonical enum codes.
-- Lock out concurrent text writes while validating and changing the column type.
BEGIN;
LOCK TABLE "User" IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE specialization IS NOT NULL
    AND specialization NOT IN ('GENERAL_PRACTICE', 'CARDIOLOGY', 'NEUROLOGY', 'ORTHOPAEDICS', 'PEDIATRICS', 'DERMATOLOGY', 'OPHTHALMOLOGY', 'ENT', 'GYNAECOLOGY', 'UROLOGY', 'neuro', 'orthopaedic ')) THEN
    RAISE EXCEPTION 'Unmapped non-null specialization values: review explicit mappings before deployment';
  END IF;
END $$;
CREATE TYPE "Specialization" AS ENUM ('GENERAL_PRACTICE', 'CARDIOLOGY', 'NEUROLOGY', 'ORTHOPAEDICS', 'PEDIATRICS', 'DERMATOLOGY', 'OPHTHALMOLOGY', 'ENT', 'GYNAECOLOGY', 'UROLOGY');
ALTER TABLE "User" ALTER COLUMN specialization TYPE "Specialization" USING
  (CASE specialization
    WHEN 'neuro' THEN 'NEUROLOGY'
    WHEN 'orthopaedic ' THEN 'ORTHOPAEDICS'
    ELSE specialization
  END)::"Specialization";
COMMIT;
