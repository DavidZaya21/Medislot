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
  HttpCode,
  ValidationPipe,
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
  RescheduleAppointmentDto,
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
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.DOCTOR, Role.MANAGER)
  listAppointments(@Query(new ValidationPipe({ expectedType: AppointmentListQueryDto, transform: true, whitelist: true })) query: AppointmentListQueryDto, @CurrentUser() user: AuthUser) {
    return this.appointmentsService.listAppointments(query.status, user);
  }

  @Post()
  @Roles(Role.RECEPTIONIST, Role.PATIENT)
  requestAppointment(
    @Body() body: CreateAppointmentDto,
    @CurrentUser() currentUser: AuthUser,
  ) {
    return this.appointmentsService.requestAppointment(body, currentUser);
  }

  @Post(":appointmentId/reschedule")
  @HttpCode(200)
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.MANAGER)
  reschedule(
    @Param("appointmentId", ParseIntPipe) appointmentId: number,
    @Body(new ValidationPipe({ expectedType: RescheduleAppointmentDto, transform: true, whitelist: true })) body: RescheduleAppointmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.appointmentsService.reschedule(appointmentId, body, user);
  }

  @Get(":appointmentId/alternatives")
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.MANAGER)
  alternatives(
    @Param("appointmentId", ParseIntPipe) appointmentId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.appointmentsService.alternatives(appointmentId, user);
  }

  @Get(":appointmentId/reschedule-options")
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.MANAGER)
  rescheduleOptions(
    @Param("appointmentId", ParseIntPipe) appointmentId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.appointmentsService.rescheduleOptions(appointmentId, user);
  }

  @Get(":appointmentId")
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.DOCTOR, Role.PATIENT, Role.MANAGER)
  getAppointmentById(
    @Param("appointmentId", ParseIntPipe) appointmentId: number,
    @CurrentUser() currentUser: AuthUser,
  ) {
    return this.appointmentsService.getAppointmentById(appointmentId, currentUser);
  }

  @Put(":appointmentId")
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.DOCTOR, Role.MANAGER, Role.PATIENT)
  reviewAppointment(
    @Param("appointmentId", ParseIntPipe) appointmentId: number,
    @Body(new ValidationPipe({expectedType:UpdateAppointmentDto,transform:true,whitelist:true})) body: UpdateAppointmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.appointmentsService.reviewAppointment(appointmentId, body, user);
  }

  @Delete(":appointmentId")
  @Roles(Role.ADMIN, Role.RECEPTIONIST)
  async deleteAppointment(@Param("appointmentId", ParseIntPipe) appointmentId: number) {
    await this.appointmentsService.deleteAppointment(appointmentId);
  }
}
