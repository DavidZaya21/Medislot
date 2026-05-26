import { Body, Controller, Inject, Post } from "@nestjs/common";

import { CreateSessionDto } from "./sessions.dto";
import { SessionsService } from "./sessions.service";

@Controller("sessions")
export class SessionsController {
  constructor(@Inject(SessionsService) private readonly sessionsService: SessionsService) {}

  @Post()
  createSession(@Body() body: CreateSessionDto) {
    return this.sessionsService.createSession(body.email, body.password);
  }
}
