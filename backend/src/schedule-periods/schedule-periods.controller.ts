import { Body, Controller, HttpCode, Inject, Post, UseGuards, ValidationPipe } from "@nestjs/common";
import { Role } from "@prisma/client";

import { AuthGuard } from "../auth/auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/auth.types";
import { PublishSchedulePeriodDto, SchedulePreviewDto } from "./schedule-periods.dto";
import { SchedulePeriodsService } from "./schedule-periods.service";

@Controller("schedulePeriods")
@UseGuards(AuthGuard, RolesGuard)
export class SchedulePeriodsController {
  constructor(@Inject(SchedulePeriodsService) private readonly service: SchedulePeriodsService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  publish(@Body(new ValidationPipe({
    expectedType: PublishSchedulePeriodDto,
    whitelist: true,
    transform: true,
    forbidUnknownValues: false,
  })) body: PublishSchedulePeriodDto, @CurrentUser() user: AuthUser) {
    return this.service.publish(body, user);
  }

  @Post("preview")
  @HttpCode(200)
  @Roles(Role.ADMIN, Role.MANAGER)
  preview(@Body(new ValidationPipe({
    expectedType: SchedulePreviewDto,
    whitelist: true,
    transform: true,
    forbidUnknownValues: false,
  })) body: SchedulePreviewDto) {
    return this.service.preview(body);
  }
}
