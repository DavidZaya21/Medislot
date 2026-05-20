import {
  Controller,
  Delete,
  Get,
  NotImplementedException,
  Param,
  Post,
  Put,
} from "@nestjs/common";

@Controller("doctors")
export class DoctorsController {
  @Get()
  listDoctors() {
    throw new NotImplementedException("Doctor listing has not been implemented yet.");
  }

  @Post()
  createDoctor() {
    throw new NotImplementedException("Doctor creation has not been implemented yet.");
  }

  @Get(":doctorId")
  getDoctorById(@Param("doctorId") _doctorId: string) {
    throw new NotImplementedException("Doctor retrieval has not been implemented yet.");
  }

  @Put(":doctorId")
  updateDoctorById(@Param("doctorId") _doctorId: string) {
    throw new NotImplementedException("Doctor update has not been implemented yet.");
  }

  @Delete(":doctorId")
  deleteDoctorById(@Param("doctorId") _doctorId: string) {
    throw new NotImplementedException("Doctor deletion has not been implemented yet.");
  }

  @Get(":doctorId/appointments")
  listAppointmentsByDoctor(@Param("doctorId") _doctorId: string) {
    throw new NotImplementedException("Doctor appointment listing has not been implemented yet.");
  }
}
