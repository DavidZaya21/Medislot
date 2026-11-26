import { Global, Module } from "@nestjs/common";

import { AppointmentLifecycle } from "../common/appointment-lifecycle";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  providers: [PrismaService, AppointmentLifecycle],
  exports: [PrismaService, AppointmentLifecycle],
})
export class PrismaModule {}
