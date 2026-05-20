import { Controller, NotImplementedException, Post } from "@nestjs/common";

@Controller("receptionists")
export class ReceptionistsController {
  @Post()
  createReceptionist() {
    throw new NotImplementedException("Receptionist creation has not been implemented yet.");
  }
}
