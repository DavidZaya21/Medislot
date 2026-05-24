import { Transform } from "class-transformer";
import { IsBoolean, IsDateString, IsInt, IsOptional, Min } from "class-validator";

export class CalendarListQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  doctorId?: number;

  @IsOptional()
  @IsDateString()
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
