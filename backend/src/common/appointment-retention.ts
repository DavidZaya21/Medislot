import type { Prisma } from "@prisma/client";
import { toConflict } from "./prisma-errors";

// Call inside the deletion transaction after locking the affected doctor(s).
// Closure takes those same locks before setting closedAt, so the check and
// deletion cannot race. Read current committed state after any lock wait.
export async function assertAppointmentDeletionAllowed(
  tx: Prisma.TransactionClient, scope: Prisma.AppointmentWhereInput,
) {
  if (await tx.appointment.findFirst({ where: { ...scope }, select: { id: true } })) {
    throw toConflict("Appointments must be retained. Cancel eligible appointments instead of deleting them");
  }
}

export async function assertAuditActorDeletionAllowed(tx: Prisma.TransactionClient, actorId: number) {
  if (await tx.appointmentStatusTransition.findFirst({ where: { actorId }, select: { id: true } })) {
    throw toConflict("Account is referenced by preserved appointment status history");
  }
}
