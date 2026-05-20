import { Controller, NotImplementedException, Post } from "@nestjs/common";

@Controller("sessions")
export class SessionsController {
  @Post()
  createSession() {
    throw new NotImplementedException("JWT login flow has not been implemented yet.");
  }
}
