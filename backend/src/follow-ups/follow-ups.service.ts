import { Inject, Injectable } from "@nestjs/common";
import { Prisma, Role, type ContactAttempt } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../auth/auth.types";
import { toConflict, toForbidden, toNotFound } from "../common/prisma-errors";
import { lockDoctor, lockPatient } from "../common/doctor-lock";
import { contactAllowed, nextContactTime } from "./follow-up-policy";
import { assertCurrentCase } from "./case-guard";
import type { ContactAttemptDto, FollowUpQueryDto, FollowUpCasesQueryDto } from "./follow-ups.dto";

function attemptResponse(row: ContactAttempt) {
  return { id: row.id, notificationId: row.notificationId, actorId: row.actorId, actorRef: row.actorRef,
    appointmentVersion: row.appointmentVersion, currentCalendarId: row.currentCalendarId, outcome: row.outcome, note: row.note, createdAt: row.createdAt };
}
@Injectable()
export class FollowUpsService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  clock = () => new Date();
  private async authorize(user: AuthUser, write = false) {
    const actor = await this.db.user.findUnique({ where: { id: user.userId }, select: { role: true } });
    const allowed: Role[] = write ? [Role.RECEPTIONIST, Role.MANAGER] : [Role.RECEPTIONIST, Role.MANAGER, Role.ADMIN];
    if (!actor || actor.role !== user.role || !allowed.includes(actor.role)) throw toForbidden();
  }
  async list(query: FollowUpQueryDto, user: AuthUser) {
    await this.authorize(user);
    const now = this.clock(), page = query.page ?? 1, pageSize = query.pageSize ?? 20;
    return this.db.$transaction(async tx => {
      // Timestamp columns are UTC instants stored without a zone. Normalize the bound explicitly.
      const cases = Prisma.sql`WITH eligible AS (
        SELECT n.id, LEAST(n."followUpDeadlineAt", n."legacyFollowUpEscalatedAt",
          CASE WHEN j.status = 'FAILED' THEN COALESCE(j."failedAt", j."updatedAt") ELSE NULL END) AS effective
        FROM "Notification" n JOIN "Appointment" a ON a.id=n."appointmentId"
        LEFT JOIN "EmailJob" j ON j."notificationId"=n.id
        WHERE n."resolvedAt" IS NULL AND n.type='DOCTOR_UNAVAILABLE' AND a.status='NEEDS_RESCHEDULING'
          AND n."recipientId"=a."patientId" AND n."calendarRef"=a."calendarId" AND n."disruptionVersion"=a.version)
        SELECT * FROM eligible WHERE effective <= (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
      const ids = await tx.$queryRaw<{id:number}[]>(Prisma.sql`SELECT id FROM (${cases}) c ORDER BY effective,id LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}`);
      const [count] = await tx.$queryRaw<{total:number}[]>(Prisma.sql`SELECT COUNT(*)::int AS total FROM (${cases}) c`);
      const rows = await tx.notification.findMany({ where: { id: { in: ids.map(r=>r.id) } }, include: {
        appointment: { include: { patient: true, calendar: true } }, emailJob: true,
        contactAttempts: { orderBy: [{createdAt:"desc"},{id:"desc"}], take: 1 }, _count: { select: { contactAttempts: true } },
      } });
      const indexed = new Map(rows.map(row=>[row.id,row]));
      const data = ids.map(({id})=>{
        const row=indexed.get(id)!, appointment=row.appointment!, patient=appointment.patient;
        const scheduled=row.followUpDeadlineAt, legacy=row.legacyFollowUpEscalatedAt;
        const failed=row.emailJob?.status === "FAILED" ? row.emailJob.failedAt ?? row.emailJob.updatedAt : null;
        const effective=new Date(Math.min(scheduled ? +scheduled : Infinity, legacy ? +legacy : Infinity, failed ? +failed : Infinity));
        return { notificationId:row.id, disruptionVersion:row.disruptionVersion, appointmentId:appointment.id,
          currentCalendarId:appointment.calendarId, expectedVersion:appointment.version,
          patient:{id:patient.id,name:patient.name,email:patient.email,phone:patient.phone},
          contactability:patient.phone ? "PHONE_AVAILABLE" : "PHONE_MISSING",
          doctorName:row.doctorName, slotStartTime:row.slotStartTime, slotEndTime:row.slotEndTime, recordedAt:scheduled ? row.createdAt : null, notificationCreatedAt:row.createdAt,
          timingBasis:scheduled ? "EXACT_POST_LOCK" : "LEGACY_UNKNOWN", legacyEscalatedAt:legacy,
          scheduledDeadlineAt:scheduled,effectiveEscalationAt:effective,phoneContactDueAt:nextContactTime(effective),
          nextContactAllowedAt:nextContactTime(now),contactAllowedNow:contactAllowed(now),
          reasons:[...(scheduled&&scheduled<=now?["DEADLINE_REACHED"]:[]),...(legacy&&legacy<=now?["LEGACY_FALLBACK"]:[]),...(failed&&failed<=now?["EMAIL_FAILED"]:[])],
          contactSummary:{count:row._count.contactAttempts,last:row.contactAttempts[0]?attemptResponse(row.contactAttempts[0]):null},
          actions:{recordContact:user.role!==Role.ADMIN&&!!patient.phone&&contactAllowed(now),reschedule:user.role!==Role.ADMIN,cancel:user.role!==Role.ADMIN},
        };
      });
      return {data,meta:{page,pageSize,total:count.total,totalPages:Math.ceil(count.total/pageSize)},asOf:now,timeZone:"Europe/Warsaw"};
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }
  // History discovery includes not-yet-escalated active cases and retained resolved/detached cases.
  async cases(query: FollowUpCasesQueryDto, user: AuthUser) {
    await this.authorize(user);
    const page = query.page ?? 1, pageSize = query.pageSize ?? 20, resolved = query.status === "RESOLVED";
    return this.db.$transaction(async tx => {
      const where: Prisma.NotificationWhereInput = { type: "DOCTOR_UNAVAILABLE", resolvedAt: resolved ? { not: null } : null };
      const orderBy: Prisma.NotificationOrderByWithRelationInput[] = resolved
        ? [{ resolvedAt: "desc" }, { id: "desc" }] : [{ createdAt: "desc" }, { id: "desc" }];
      const [rows, total] = await Promise.all([
        tx.notification.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize,
          include: { recipient: { select: { name: true } }, _count: { select: { contactAttempts: true } } } }),
        tx.notification.count({ where }),
      ]);
      return { data: rows.map(row => ({ notificationId: row.id, appointmentRef: row.appointmentRef, appointmentId: row.appointmentId,
        disruptionVersion: row.disruptionVersion, patientName: row.recipient?.name ?? null, doctorName: row.doctorName,
        slotStartTime: row.slotStartTime, slotEndTime: row.slotEndTime, createdAt: row.createdAt, resolvedAt: row.resolvedAt,
        contactCount: row._count.contactAttempts })), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async history(notificationId:number,query:FollowUpQueryDto,user:AuthUser) {
    await this.authorize(user);
    const page=query.page??1,pageSize=query.pageSize??20;
    return this.db.$transaction(async tx=>{
      const notice=await tx.notification.findUnique({where:{id:notificationId},select:{id:true,resolvedAt:true,appointmentRef:true,disruptionVersion:true}});
      if(!notice)throw toNotFound("Disruption");
      const where={notificationId};
      const [data,total]=await Promise.all([tx.contactAttempt.findMany({where,orderBy:[{createdAt:"desc"},{id:"desc"}],skip:(page-1)*pageSize,take:pageSize}),tx.contactAttempt.count({where})]);
      return {case:notice,data:data.map(attemptResponse),meta:{page,pageSize,total,totalPages:Math.ceil(total/pageSize)}};
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }
  // Read-only replay depends on preserved case identity, not mutable/live appointment relations.
  private async replay(db: Pick<Prisma.TransactionClient, "notification" | "contactAttempt">, appointmentId: number, input: ContactAttemptDto, user: AuthUser) {
    const notice = await db.notification.findUnique({ where: { id: input.notificationId } });
    if (!notice) return null;
    if (notice.appointmentRef !== appointmentId || notice.disruptionVersion !== input.disruptionVersion) {
      throw toConflict("Disruption changed. Reload the case");
    }
    const existing = await db.contactAttempt.findUnique({ where: { notificationId_idempotencyKey: {
      notificationId: input.notificationId, idempotencyKey: input.idempotencyKey,
    } } });
    if (!existing) return null;
    if (existing.actorRef !== user.userId || existing.outcome !== input.outcome || existing.note !== (input.note ?? null) ||
        existing.appointmentVersion !== input.expectedVersion || existing.currentCalendarId !== input.currentCalendarId) {
      throw toConflict("Idempotency key was already used with different contact details");
    }
    return attemptResponse(existing);
  }
  async record(appointmentId:number,input:ContactAttemptDto,user:AuthUser) {
    await this.authorize(user,true);
    const replayed = await this.replay(this.db, appointmentId, input, user);
    if (replayed) return replayed;
    const found=await this.db.appointment.findUnique({where:{id:appointmentId}});
    if(!found) {
      const replayedAfterDeletion = await this.replay(this.db, appointmentId, input, user);
      if (replayedAfterDeletion) return replayedAfterDeletion;
      throw toNotFound("Appointment");
    }
    try { return await this.db.$transaction(async tx=>{
      await lockDoctor(tx,found.doctorId);await lockPatient(tx,found.patientId);
      await tx.$queryRaw`SELECT id FROM "Appointment" WHERE id=${appointmentId} FOR UPDATE`;
      const current=await tx.appointment.findUnique({where:{id:appointmentId}});
      const actor=await tx.user.findUnique({where:{id:user.userId},select:{role:true}});
      if(!actor||actor.role!==user.role||![Role.RECEPTIONIST,Role.MANAGER].includes(actor.role as "RECEPTIONIST"|"MANAGER"))throw toForbidden();
      await tx.$queryRaw`SELECT id FROM "Notification" WHERE id=${input.notificationId} FOR UPDATE`;
      const notice=await tx.notification.findUnique({where:{id:input.notificationId}});
      if(!notice||notice.appointmentRef!==appointmentId||notice.disruptionVersion!==input.disruptionVersion)throw toConflict("Disruption changed. Reload the case");
      const concurrentReplay = await this.replay(tx, appointmentId, input, user);
      if (concurrentReplay) return concurrentReplay;
      if(!current||current.doctorId!==found.doctorId||current.patientId!==found.patientId)throw toConflict("Appointment changed. Reload the case");
      await assertCurrentCase(tx,current,input);
      const now=this.clock();
      if(!contactAllowed(now))throw toConflict("Phone contact is allowed 08:00–20:00 Europe/Warsaw. Reload for the next opening");
      const patient=await tx.user.findUnique({where:{id:current.patientId},select:{phone:true}});
      if(!patient?.phone)throw toConflict("Phone number missing. Update contact details before recording a call");
      return attemptResponse(await tx.contactAttempt.create({data:{notificationId:notice.id,actorId:user.userId,actorRef:user.userId,
        appointmentVersion:current.version,currentCalendarId:current.calendarId,outcome:input.outcome,note:input.note??null,idempotencyKey:input.idempotencyKey,createdAt:now}}));
    },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,timeout:15000});
    } catch (error) {
      // A successful competing request may have been followed by deletion while we waited.
      if (typeof error === "object" && error !== null && "getStatus" in error &&
          typeof error.getStatus === "function" && error.getStatus() === 404) {
        await this.authorize(user, true);
        const replayedAfterWait = await this.replay(this.db, appointmentId, input, user);
        if (replayedAfterWait) return replayedAfterWait;
      }
      throw error;
    }
  }
}
