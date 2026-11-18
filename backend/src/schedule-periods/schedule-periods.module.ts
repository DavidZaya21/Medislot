import { Module } from "@nestjs/common";

import { SchedulePeriodsController } from "./schedule-periods.controller";
import { SchedulePeriodsService } from "./schedule-periods.service";

@Module({
  controllers: [SchedulePeriodsController],
  providers: [SchedulePeriodsService],
})
export class SchedulePeriodsModule {}
