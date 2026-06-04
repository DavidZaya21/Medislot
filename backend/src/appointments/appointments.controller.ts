import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Put,
  UseGuards,
} from "@nestjs/common";
import { Role } from "@prisma/client";

import { AuthGuard } from "../auth/auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/auth.types";
import {
  AppointmentListQueryDto,
  CreateAppointmentDto,
  UpdateAppointmentDto,
} from "./appointments.dto";
import { AppointmentsService } from "./appointments.service";

@Controller("appointments")
@UseGuards(AuthGuard, RolesGuard)
export class AppointmentsController {
  constructor(
    @Inject(AppointmentsService)
    private readonly appointmentsService: AppointmentsService,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.DOCTOR)
  listAppointments(@Query() query: AppointmentListQueryDto) {
    return this.appointmentsService.listAppointments(query.status);
  }

  @Post()
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.PATIENT)
  requestAppointment(
    @Body() body: CreateAppointmentDto,
    @CurrentUser() currentUser: AuthUser,
  ) {
    return this.appointmentsService.requestAppointment(body, currentUser);
  }

  @Get(":appointmentId")
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.DOCTOR, Role.PATIENT)
  getAppointmentById(@Param("appointmentId", ParseIntPipe) appointmentId: number) {
    return this.appointmentsService.getAppointmentById(appointmentId);
  }

  @Put(":appointmentId")
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.DOCTOR)
  reviewAppointment(
    @Param("appointmentId", ParseIntPipe) appointmentId: number,
    @Body() body: UpdateAppointmentDto,
  ) {
    return this.appointmentsService.reviewAppointment(appointmentId, body);
  }

  @Delete(":appointmentId")
  @Roles(Role.ADMIN, Role.RECEPTIONIST)
  async deleteAppointment(@Param("appointmentId", ParseIntPipe) appointmentId: number) {
    await this.appointmentsService.deleteAppointment(appointmentId);
  }
}
