import {
  Body,
  HttpCode,
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
  ValidationPipe,
} from "@nestjs/common";
import { Role } from "@prisma/client";

import { AuthGuard, ClosureAuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { AppointmentListQueryDto } from "../appointments/appointments.dto";
import {
  PatientRegistrationDto,
  ClosePatientAccountDto,
  UserListQueryDto,
  UserUpdateDto,
} from "./users.dto";
import { UsersService } from "./users.service";

@Controller("users")
export class UsersController {
  constructor(@Inject(UsersService) private readonly usersService: UsersService) {}

  @Post()
  registerPatient(@Body(new ValidationPipe({ expectedType: PatientRegistrationDto, transform: true, whitelist: true })) body: PatientRegistrationDto) {
    return this.usersService.registerPatient(body);
  }

  @Post("me/close")
  @HttpCode(200)
  @UseGuards(ClosureAuthGuard, RolesGuard)
  @Roles(Role.PATIENT)
  closeOwnAccount(@Body(new ValidationPipe({ expectedType: ClosePatientAccountDto, transform: true, whitelist: true })) body: ClosePatientAccountDto,
    @CurrentUser() user: AuthUser) { return this.usersService.closePatientAccount(user.userId, body); }

  @Get()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.RECEPTIONIST)
  listUsers(
    @Query(new ValidationPipe({expectedType:UserListQueryDto,transform:true,whitelist:true})) query: UserListQueryDto,
    @CurrentUser() currentUser: AuthUser,
  ) {
    return this.usersService.listUsers(query, currentUser);
  }

  @Get(":userId")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.DOCTOR, Role.PATIENT, Role.MANAGER)
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
    @Body(new ValidationPipe({ expectedType: UserUpdateDto, transform: true, whitelist: true })) body: UserUpdateDto,
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
