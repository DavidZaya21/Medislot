import { ContactOutcome } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";
export class FollowUpQueryDto {
  @IsOptional() @Transform(({value})=>value===undefined?undefined:Number(value)) @IsInt() @Min(1) @Max(1000000)
  page?: number;
  @IsOptional() @Transform(({value})=>value===undefined?undefined:Number(value)) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
}
export class FollowUpCasesQueryDto extends FollowUpQueryDto {
  @IsOptional() @IsEnum({ ACTIVE: "ACTIVE", RESOLVED: "RESOLVED" })
  status?: "ACTIVE" | "RESOLVED";
}
export class ContactAttemptDto {
  @IsInt() @Min(1) @Max(2147483647) notificationId!: number;
  @IsInt() @Min(1) @Max(2147483647) disruptionVersion!: number;
  @IsInt() @Min(1) @Max(2147483647) currentCalendarId!: number;
  @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
  @IsEnum(ContactOutcome) outcome!: ContactOutcome;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsUUID() idempotencyKey!: string;
}
