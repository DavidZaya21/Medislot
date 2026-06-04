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
import { AppointmentListQueryDto } from "../appointments/appointments.dto";
import { CreateDoctorDto, DoctorListQueryDto, UpdateDoctorDto } from "./doctors.dto";
import { DoctorsService } from "./doctors.service";

@Controller("doctors")
@UseGuards(AuthGuard, RolesGuard)
export class DoctorsController {
  constructor(@Inject(DoctorsService) private readonly doctorsService: DoctorsService) {}

  @Get()
  listDoctors(@Query() query: DoctorListQueryDto) {
    return this.doctorsService.listDoctors(query);
  }

  @Post()
  @Roles(Role.ADMIN)
  createDoctor(@Body() body: CreateDoctorDto) {
    return this.doctorsService.createDoctor(body);
  }

  @Get(":doctorId")
  getDoctorById(@Param("doctorId", ParseIntPipe) doctorId: number) {
    return this.doctorsService.getDoctorById(doctorId);
  }

  @Put(":doctorId")
  @Roles(Role.ADMIN, Role.DOCTOR)
  updateDoctorById(
    @Param("doctorId", ParseIntPipe) doctorId: number,
    @Body() body: UpdateDoctorDto,
  ) {
    return this.doctorsService.updateDoctorById(doctorId, body);
  }

  @Delete(":doctorId")
  @Roles(Role.ADMIN)
  async deleteDoctorById(@Param("doctorId", ParseIntPipe) doctorId: number) {
    await this.doctorsService.deleteDoctorById(doctorId);
  }

  @Get(":doctorId/appointments")
  listAppointmentsByDoctor(
    @Param("doctorId", ParseIntPipe) doctorId: number,
    @Query() query: AppointmentListQueryDto,
  ) {
    return this.doctorsService.listAppointmentsByDoctor(doctorId, query.status);
  }
}
