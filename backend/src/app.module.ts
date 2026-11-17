import { Module } from "@nestjs/common";

import { AppointmentsModule } from "./appointments/appointments.module";
import { AuthGuard } from "./auth/auth.guard";
import { RolesGuard } from "./auth/roles.guard";
import { CalendarsModule } from "./calendars/calendars.module";
import { DoctorsModule } from "./doctors/doctors.module";
import { HealthModule } from "./health/health.module";
import { ManagersModule } from "./managers/managers.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ReceptionistsModule } from "./receptionists/receptionists.module";
import { SessionsModule } from "./sessions/sessions.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    SessionsModule,
    UsersModule,
    DoctorsModule,
    ReceptionistsModule,
    ManagersModule,
    CalendarsModule,
    AppointmentsModule,
  ],
  providers: [AuthGuard, RolesGuard],
})
export class AppModule {}
