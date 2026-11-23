import { Controller, Get, Inject, Param, ParseIntPipe, Patch, Query, UseGuards, ValidationPipe } from "@nestjs/common";
import { Role } from "@prisma/client";
import { AuthGuard } from "../auth/auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/auth.types";
import { NotificationsService } from "./notifications.service";
import { NotificationQueryDto } from "./notifications.dto";
@Controller("notifications")
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.PATIENT)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly service: NotificationsService) {}
  @Get()
  list(@Query(new ValidationPipe({ expectedType: NotificationQueryDto, transform: true, whitelist: true })) query: NotificationQueryDto,
    @CurrentUser() user: AuthUser) { return this.service.list(user.userId, query); }
  @Patch(":notificationId/read")
  read(@Param("notificationId", ParseIntPipe) id: number, @CurrentUser() user: AuthUser) { return this.service.read(id, user.userId); }
}
