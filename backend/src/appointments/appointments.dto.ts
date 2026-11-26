import { AppointmentStatus } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsEnum, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

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
  @IsOptional() @IsBoolean() legacyDisruption?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) notificationId?: number;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) disruptionVersion?: number;
  @IsInt() @Min(1) @Max(2147483647) currentCalendarId!: number;
  @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
  @IsIn(["CANCELLED", "COMPLETED", "NO_SHOW"])
  status!: AppointmentStatus;
  // Legacy clients may send the old field; status changes never alter the reason.
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
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
