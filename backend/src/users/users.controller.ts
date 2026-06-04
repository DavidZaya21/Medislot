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
import { CurrentUser } from "../auth/current-user.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { AppointmentListQueryDto } from "../appointments/appointments.dto";
import {
  PatientRegistrationDto,
  UserListQueryDto,
  UserUpdateDto,
} from "./users.dto";
import { UsersService } from "./users.service";

@Controller("users")
export class UsersController {
  constructor(@Inject(UsersService) private readonly usersService: UsersService) {}

  @Post()
  registerPatient(@Body() body: PatientRegistrationDto) {
    return this.usersService.registerPatient(body);
  }

  @Get()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.RECEPTIONIST)
  listUsers(
    @Query() query: UserListQueryDto,
    @CurrentUser() currentUser: AuthUser,
  ) {
    return this.usersService.listUsers(query, currentUser);
  }

  @Get(":userId")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.DOCTOR, Role.PATIENT)
  getUserById(
    @Param("userId", ParseIntPipe) userId: number,
    @CurrentUser() currentUser: AuthUser,
  ) {
    return this.usersService.getUserById(userId, currentUser);
  }

  @Put(":userId")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.PATIENT, Role.DOCTOR)
  updateUserById(
    @Param("userId", ParseIntPipe) userId: number,
    @Body() body: UserUpdateDto,
    @CurrentUser() currentUser: AuthUser,
  ) {
    return this.usersService.updateUserById(userId, body, currentUser);
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
    @CurrentUser() currentUser: AuthUser,
  ) {
    return this.usersService.listAppointmentsByUser(userId, query.status, currentUser);
  }
}
