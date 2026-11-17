import { Body, Controller, Inject, Post, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";

import { AuthGuard } from "../auth/auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { CreateManagerDto } from "./managers.dto";
import { ManagersService } from "./managers.service";

@Controller("managers")
@UseGuards(AuthGuard, RolesGuard)
export class ManagersController {
  constructor(
    @Inject(ManagersService)
    private readonly managersService: ManagersService,
  ) {}

  @Post()
  @Roles(Role.ADMIN)
  createManager(@Body() body: CreateManagerDto) {
    return this.managersService.createManager(body);
  }
}
