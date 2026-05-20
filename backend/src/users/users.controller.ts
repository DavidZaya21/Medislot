import {
  Controller,
  Delete,
  Get,
  NotImplementedException,
  Param,
  Post,
  Put,
} from "@nestjs/common";

@Controller("users")
export class UsersController {
  @Post()
  registerPatient() {
    throw new NotImplementedException("Patient registration has not been implemented yet.");
  }

  @Get()
  listUsers() {
    throw new NotImplementedException("User listing has not been implemented yet.");
  }

  @Get(":userId")
  getUserById(@Param("userId") _userId: string) {
    throw new NotImplementedException("User retrieval has not been implemented yet.");
  }

  @Put(":userId")
  updateUserById(@Param("userId") _userId: string) {
    throw new NotImplementedException("User update has not been implemented yet.");
  }

  @Delete(":userId")
  deleteUserById(@Param("userId") _userId: string) {
    throw new NotImplementedException("User deletion has not been implemented yet.");
  }

  @Get(":userId/appointments")
  listAppointmentsByUser(@Param("userId") _userId: string) {
    throw new NotImplementedException("Patient appointment listing has not been implemented yet.");
  }
}
