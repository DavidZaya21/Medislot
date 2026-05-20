import { Module } from "@nestjs/common";

import { ReceptionistsController } from "./receptionists.controller";

@Module({
  controllers: [ReceptionistsController],
})
export class ReceptionistsModule {}
