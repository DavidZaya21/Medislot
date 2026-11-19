import {
  ArrayNotEmpty, ArrayUnique, IsArray, IsDateString, IsInt, Matches, Max, Min,
} from "class-validator";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export class SchedulePreviewDto {
  @IsInt()
  @Min(1)
  @Max(2147483647)
  doctorId!: number;

  @Matches(datePattern)
  @IsDateString({ strict: true })
  startDate!: string;

  @Matches(datePattern)
  @IsDateString({ strict: true })
  endDate!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  workingWeekdays!: number[];

  @Matches(timePattern)
  dailyStartTime!: string;

  @Matches(timePattern)
  dailyEndTime!: string;

  @IsInt()
  @Min(1)
  @Max(1440)
  slotDurationMinutes!: number;

  @IsArray()
  @ArrayUnique()
  @Matches(datePattern, { each: true })
  @IsDateString({ strict: true }, { each: true })
  excludedDates!: string[];
}

export class PublishSchedulePeriodDto extends SchedulePreviewDto {
  // Zero-based indexes in the chronologically ordered server-generated preview.
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  removedSlotIds!: number[];
}
