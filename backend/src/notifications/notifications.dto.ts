import { Transform } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, Max, Min } from "class-validator";
export class NotificationQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === undefined ? undefined : Number(value))
  @IsInt() @Min(1) @Max(1000000)
  page?: number;
  @IsOptional()
  @Transform(({ value }) => value === undefined ? undefined : Number(value))
  @IsInt() @Min(1) @Max(100)
  pageSize?: number;
  @IsOptional()
  @Transform(({ value }) => value === "true" ? true : value === "false" ? false : value)
  @IsBoolean()
  unread?: boolean;
  @IsOptional()
  @Transform(({ value }) => value === "true" ? true : value === "false" ? false : value)
  @IsBoolean()
  needsAction?: boolean;
}
