import { Body, Controller, Inject, Post, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";

import { AuthGuard } from "../auth/auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { CreateReceptionistDto } from "./receptionists.dto";
import { ReceptionistsService } from "./receptionists.service";

@Controller("receptionists")
@UseGuards(AuthGuard, RolesGuard)
export class ReceptionistsController {
  constructor(
    @Inject(ReceptionistsService)
    private readonly receptionistsService: ReceptionistsService,
  ) {
    this.createReceptionist = this.createReceptionist.bind(this);
  }

  @Post()
  @Roles(Role.ADMIN)
  createReceptionist(@Body() body: CreateReceptionistDto) {
    return this.receptionistsService.createReceptionist(body);
  }
}
