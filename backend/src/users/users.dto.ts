import { normalizePatientPhone } from "../common/patient-phone";
import { Role } from "@prisma/client";
import { Transform } from "class-transformer";
import {
  IsEmail,
  Equals,
  IsUUID,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  MinLength,
  Min,
} from "class-validator";

export class PatientRegistrationDto {
  @IsOptional()
  @Transform(({ value }) => value === undefined ? undefined : normalizePatientPhone(value))
  @IsString()
  phone?: string | null;
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(255)
  password!: string;
}

export class UserUpdateDto {
  @IsOptional()
  @Transform(({ value }) => value === undefined ? undefined : normalizePatientPhone(value))
  @IsString()
  phone?: string | null;
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsEmail()
  email!: string;
}

export class UserListQueryDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ClosePatientAccountDto {
  @IsString() @MinLength(1) @MaxLength(255)
  currentPassword!: string;
  @Equals(true)
  confirmed!: boolean;
  @IsUUID("4")
  requestId!: string;
}
