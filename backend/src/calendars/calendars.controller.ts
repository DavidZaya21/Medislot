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
import { CalendarsService } from "./calendars.service";
import { BlockCalendarDto, CalendarListQueryDto, CreateCalendarDto, UpdateCalendarDto } from "./calendars.dto";

@Controller("calendars")
@UseGuards(AuthGuard, RolesGuard)
export class CalendarsController {
  constructor(
    @Inject(CalendarsService)
    private readonly calendarsService: CalendarsService,
  ) {}

  @Get()
  listCalendarSlots(@Query() query: CalendarListQueryDto) {
    return this.calendarsService.listCalendarSlots(query);
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

  @Get(":calendarId")
  getCalendarSlotById(@Param("calendarId", ParseIntPipe) calendarId: number) {
    return this.calendarsService.getCalendarSlotById(calendarId);
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
