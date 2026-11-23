import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { toNotFound } from "../common/prisma-errors";
import type { NotificationQueryDto } from "./notifications.dto";
import { Prisma, type Notification } from "@prisma/client";
function serialize(notice: Notification) {
  return { id: notice.id, appointmentId: notice.appointmentId, disruptionVersion: notice.disruptionVersion,
    type: notice.type, doctorName: notice.doctorName, slotStartTime: notice.slotStartTime, slotEndTime: notice.slotEndTime,
    createdAt: notice.createdAt, readAt: notice.readAt, resolvedAt: notice.resolvedAt,
    href: notice.appointmentId === null ? null : `/appointments?reschedule=${notice.appointmentId}` };
}
@Injectable()
export class NotificationsService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async list(recipientId: number, query: NotificationQueryDto) {
    const page = query.page ?? 1, pageSize = query.pageSize ?? 20;
    const where: Prisma.NotificationWhereInput = { recipientId,
      ...(query.unread === undefined ? {} : { readAt: query.unread ? null : { not: null } }),
      ...(query.needsAction === undefined ? {} : { resolvedAt: query.needsAction ? null : { not: null } }),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.notification.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
      this.db.notification.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { data: rows.map(serialize), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }
  async read(id: number, recipientId: number) {
    await this.db.notification.updateMany({ where: { id, recipientId, readAt: null }, data: { readAt: new Date() } });
    const notice = await this.db.notification.findFirst({ where: { id, recipientId } });
    if (!notice) throw toNotFound("Notification");
    return serialize(notice);
  }
}
