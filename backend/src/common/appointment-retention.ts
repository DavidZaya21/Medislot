import type { Prisma } from "@prisma/client";
import { toConflict } from "./prisma-errors";

// Call inside the deletion transaction after locking the affected doctor(s).
// Closure takes those same locks before setting closedAt, so the check and
// deletion cannot race. Read current committed state after any lock wait.
export async function assertAppointmentDeletionAllowed(
  tx: Prisma.TransactionClient, scope: Prisma.AppointmentWhereInput,
) {
  if (await tx.appointment.findFirst({ where: { AND: [scope, { patient: { closedAt: { not: null } } }] }, select: { id: true } })) {
    throw toConflict("Closed patient history must be retained");
  }
}
