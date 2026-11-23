import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import { Role } from "@prisma/client";

import { AuthGuard } from "../auth/auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/auth.types";
import { CalendarsService } from "./calendars.service";
import { BlockCalendarDto, CalendarAlternativesQueryDto, CalendarListQueryDto, CreateCalendarDto, UpdateCalendarDto } from "./calendars.dto";

@Controller("calendars")
@UseGuards(AuthGuard, RolesGuard)
export class CalendarsController {
  constructor(
    @Inject(CalendarsService)
    private readonly calendarsService: CalendarsService,
  ) {}

  @Get()
  listCalendarSlots(
    @Query(new ValidationPipe({ expectedType: CalendarListQueryDto, transform: true, whitelist: true })) query: CalendarListQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.calendarsService.listCalendarSlots(query, user);
  }

  @Post("block")
  @Roles(Role.ADMIN, Role.MANAGER)
  block(@Body(new ValidationPipe({ expectedType: BlockCalendarDto, transform: true, whitelist: true })) body: BlockCalendarDto) {
    return this.calendarsService.block(body);
  }

  @Post()
  @Roles(Role.DOCTOR, Role.ADMIN)
  createCalendarSlot(@Body() body: CreateCalendarDto) {
    return this.calendarsService.createCalendarSlot(body);
  }

  @Get(":calendarId/alternatives")
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.ADMIN)
  alternatives(
    @Param("calendarId", ParseIntPipe) calendarId: number,
    @Query(new ValidationPipe({ expectedType: CalendarAlternativesQueryDto, transform: true, whitelist: true })) query: CalendarAlternativesQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.calendarsService.alternatives(calendarId, query.patientId, user);
  }

  @Get(":calendarId")
  getCalendarSlotById(@Param("calendarId", ParseIntPipe) calendarId: number, @CurrentUser() user: AuthUser) {
    return this.calendarsService.getCalendarSlotById(calendarId, user);
  }

  @Put(":calendarId")
  @Roles(Role.DOCTOR, Role.ADMIN)
  updateCalendarSlotById(
    @Param("calendarId", ParseIntPipe) calendarId: number,
    @Body(new ValidationPipe({ expectedType: UpdateCalendarDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: UpdateCalendarDto,
  ) {
    return this.calendarsService.updateCalendarSlotById(calendarId, body);
  }

  @Delete(":calendarId")
  @Roles(Role.DOCTOR, Role.ADMIN)
  async deleteCalendarSlotById(@Param("calendarId", ParseIntPipe) calendarId: number) {
    await this.calendarsService.deleteCalendarSlotById(calendarId);
  }
}
