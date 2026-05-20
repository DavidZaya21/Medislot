import { Module } from "@nestjs/common";

import { AppointmentsModule } from "./appointments/appointments.module";
import { DoctorsModule } from "./doctors/doctors.module";
import { HealthModule } from "./health/health.module";
import { ReceptionistsModule } from "./receptionists/receptionists.module";
import { SessionsModule } from "./sessions/sessions.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    HealthModule,
    SessionsModule,
    UsersModule,
    DoctorsModule,
    ReceptionistsModule,
    AppointmentsModule,
  ],
})
export class AppModule {}
