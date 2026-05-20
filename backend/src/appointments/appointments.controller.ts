import {
  Controller,
  Delete,
  Get,
  NotImplementedException,
  Param,
  Post,
  Put,
} from "@nestjs/common";

@Controller("appointments")
export class AppointmentsController {
  @Get()
  listAppointments() {
    throw new NotImplementedException("Appointment listing has not been implemented yet.");
  }

  @Post()
  requestAppointment() {
    throw new NotImplementedException("Appointment creation has not been implemented yet.");
  }

  @Get(":appointmentId")
  getAppointmentById(@Param("appointmentId") _appointmentId: string) {
    throw new NotImplementedException("Appointment retrieval has not been implemented yet.");
  }

  @Put(":appointmentId")
  reviewAppointment(@Param("appointmentId") _appointmentId: string) {
    throw new NotImplementedException("Appointment review has not been implemented yet.");
  }

  @Delete(":appointmentId")
  deleteAppointment(@Param("appointmentId") _appointmentId: string) {
    throw new NotImplementedException("Appointment deletion has not been implemented yet.");
  }
}
