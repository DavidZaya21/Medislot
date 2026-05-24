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
import {
  PatientRegistrationDto,
  UserListQueryDto,
  UserUpdateDto,
} from "./users.dto";
import { UsersService } from "./users.service";

@Controller("users")
export class UsersController {
  constructor(@Inject(UsersService) private readonly usersService: UsersService) {
    this.registerPatient = this.registerPatient.bind(this);
    this.listUsers = this.listUsers.bind(this);
    this.getUserById = this.getUserById.bind(this);
    this.updateUserById = this.updateUserById.bind(this);
    this.deleteUserById = this.deleteUserById.bind(this);
    this.listAppointmentsByUser = this.listAppointmentsByUser.bind(this);
  }

  @Post()
  registerPatient(@Body() body: PatientRegistrationDto) {
    return this.usersService.registerPatient(body);
  }

  @Get()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.RECEPTIONIST)
  listUsers(@Query() query: UserListQueryDto) {
    return this.usersService.listUsers(query.role);
  }

  @Get(":userId")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.DOCTOR, Role.PATIENT)
  getUserById(@Param("userId", ParseIntPipe) userId: number) {
    return this.usersService.getUserById(userId);
  }

  @Put(":userId")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.PATIENT, Role.DOCTOR)
  updateUserById(
    @Param("userId", ParseIntPipe) userId: number,
    @Body() body: UserUpdateDto,
  ) {
    return this.usersService.updateUserById(userId, body);
  }

  @Delete(":userId")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async deleteUserById(@Param("userId", ParseIntPipe) userId: number) {
    await this.usersService.deleteUserById(userId);
  }

  @Get(":userId/appointments")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.PATIENT)
  listAppointmentsByUser(
    @Param("userId", ParseIntPipe) userId: number,
    @Query() query: AppointmentListQueryDto,
  ) {
    return this.usersService.listAppointmentsByUser(userId, query.status);
  }
}
