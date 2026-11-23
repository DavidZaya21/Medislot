import { parsePhoneNumberFromString } from "libphonenumber-js";
import { toBadRequest } from "./prisma-errors";
export function normalizePatientPhone(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim().startsWith("+")) throw toBadRequest("Use an international phone number, including country code (for example +48).");
  const parsed = parsePhoneNumberFromString(value.trim());
  if (!parsed?.isValid()) throw toBadRequest("Enter a valid international phone number.");
  return parsed.number;
}
