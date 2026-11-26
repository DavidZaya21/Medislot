import { Injectable } from "@nestjs/common";
import type { AppointmentStatus, Prisma } from "@prisma/client";

@Injectable()
export class AppointmentLifecycle {
  // Called only after the relevant row locks. Injectable for exact boundary tests.
  now() { return new Date(); }
  async record(tx: Prisma.TransactionClient, appointment: { id: number; version: number },
    fromStatus: AppointmentStatus, toStatus: AppointmentStatus, actorId: number, now: Date) {
    if (fromStatus === toStatus) return;
    await tx.appointmentStatusTransition.create({ data: { appointmentId: appointment.id,
      appointmentVersion: appointment.version, fromStatus, toStatus, actorId, createdAt: now } });
  }
}
