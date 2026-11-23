import { AppointmentStatus } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

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
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) notificationId?: number;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) disruptionVersion?: number;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) currentCalendarId?: number;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) expectedVersion?: number;
  @IsIn(["CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"])
  status!: AppointmentStatus;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class RescheduleAppointmentDto {
  @IsInt()
  @Min(1)
  @Max(2147483647)
  currentCalendarId!: number;

  @IsInt()
  @Min(1)
  @Max(2147483647)
  newCalendarId!: number;

  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;
}
