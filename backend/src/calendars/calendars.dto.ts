import { Transform } from "class-transformer";
import { IsBoolean, IsEmpty, IsDateString, IsInt, IsOptional, Matches, Max, Min } from "class-validator";

export class CalendarListQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(2147483647)
  doctorId?: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  date?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value === "true" || value === true) return true;
    if (value === "false" || value === false) return false;
    return value;
  })
  @IsBoolean()
  isBooked?: boolean;
}

export class CreateCalendarDto {
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  doctorId!: number;

  @IsDateString()
  startTime!: string;

  @IsDateString()
  endTime!: string;
}

export class UpdateCalendarDto {
  @IsEmpty()
  doctorId?: never;

  @IsEmpty()
  isBlocked?: never;

  @IsDateString()
  startTime!: string;

  @IsDateString()
  endTime!: string;

  @Transform(({ value }) => {
    if (value === "true" || value === true) return true;
    if (value === "false" || value === false) return false;
    return value;
  })
  @IsBoolean()
  isBooked!: boolean;
}

export class BlockCalendarDto {
  @IsInt()
  @Min(1)
  doctorId!: number;

  @IsDateString({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  startTime!: string;

  @IsDateString({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  endTime!: string;
}

export class CalendarAlternativesQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === undefined ? undefined : Number(value))
  @IsInt()
  @Min(1)
  @Max(2147483647)
  patientId?: number;
}
