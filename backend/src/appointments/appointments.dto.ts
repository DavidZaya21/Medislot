import { AppointmentStatus } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from "class-validator";

export class AppointmentListQueryDto {
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;
}

export class CreateAppointmentDto {
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  patientId!: number;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  doctorId!: number;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  calendarId!: number;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class UpdateAppointmentDto {
  @IsEnum(AppointmentStatus)
  status!: AppointmentStatus;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
